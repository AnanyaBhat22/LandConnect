"""Call signalling: the rules for ringing, accepting, rejecting and ending calls.

This class knows nothing about websockets. It receives actions ("user A
invites user B") and tells the outside world what to send via an `emit`
callback. That keeps the rules easy to read and lets tests drive it directly.

Lifecycle (status stored in the call_logs table):

    invite ──► RINGING ──accept──► ONGOING ──hangup──► COMPLETED
                  │ ├─reject──► REJECTED
                  │ ├─caller hangs up──► CANCELLED
                  │ └─no answer in N s / callee offline──► MISSED

Events sent to clients:
    call:incoming  → callee          {call_id, kind, caller}
    call:accepted  → caller & callee {call_id, kind, room, livekit_url, token, peer}
    call:ended     → caller & callee {call_id, status, reason}

Active calls live in memory (one server process is enough for the prototype).
Scaling to several instances would move this state to Redis.
"""
import asyncio
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import and_, exists, or_, select
from sqlalchemy.orm import Session, aliased

from app.core.config import settings
from app.models import Block, CallKind, CallLog, CallPermission, CallStatus, Participant, User
from app.schemas import UserPublic
from app.services.livekit import call_room_name, create_join_token

Emit = Callable[[str, dict[str, Any], uuid.UUID], Awaitable[None]]


class CallError(Exception):
    """A call action was refused. `code` is stable so the app can show a friendly message."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class ActiveCall:
    id: uuid.UUID
    caller_id: uuid.UUID
    callee_id: uuid.UUID
    kind: CallKind
    status: CallStatus = CallStatus.RINGING
    caller_public: dict[str, Any] | None = None  # kept to re-send call:incoming after a reconnect
    timer: asyncio.Task | None = field(default=None, repr=False)

    def other(self, user_id: uuid.UUID) -> uuid.UUID:
        return self.callee_id if user_id == self.caller_id else self.caller_id


def _now() -> datetime:
    return datetime.now(UTC)


def _public(user: User) -> dict[str, Any]:
    return UserPublic.model_validate(user).model_dump(mode="json")


def have_shared_conversation(db: Session, a: uuid.UUID, b: uuid.UUID) -> bool:
    pa, pb = aliased(Participant), aliased(Participant)
    stmt = select(
        exists().where(
            pa.conversation_id == pb.conversation_id, pa.user_id == a, pb.user_id == b
        )
    )
    return bool(db.scalar(stmt))


def is_blocked_either_way(db: Session, a: uuid.UUID, b: uuid.UUID) -> bool:
    stmt = select(
        exists().where(
            or_(
                and_(Block.blocker_id == a, Block.blocked_id == b),
                and_(Block.blocker_id == b, Block.blocked_id == a),
            )
        )
    )
    return bool(db.scalar(stmt))


class CallManager:
    def __init__(
        self,
        emit: Emit,
        session_factory: Callable[[], Session],
        is_online: Callable[[uuid.UUID], bool],
        ring_timeout: float = 30.0,
        disconnect_grace: float = 20.0,
    ):
        self.emit = emit
        self.session_factory = session_factory
        self.is_online = is_online
        self.ring_timeout = ring_timeout
        self.disconnect_grace = disconnect_grace
        self.calls: dict[uuid.UUID, ActiveCall] = {}
        self.user_call: dict[uuid.UUID, uuid.UUID] = {}  # user -> the call they're in
        self._grace_timers: dict[uuid.UUID, asyncio.Task] = {}

    # ---------- helpers ----------

    async def _db(self, fn: Callable[[Session], Any]) -> Any:
        """Run a short DB function in a worker thread so the event loop never blocks."""

        def run() -> Any:
            with self.session_factory() as db:
                return fn(db)

        return await asyncio.to_thread(run)

    def _get(self, call_id: uuid.UUID, user_id: uuid.UUID) -> ActiveCall:
        call = self.calls.get(call_id)
        if call is None or user_id not in (call.caller_id, call.callee_id):
            raise CallError("INVALID_CALL", "This call has already ended")
        return call

    def busy(self, user_id: uuid.UUID) -> bool:
        return user_id in self.user_call

    # ---------- actions ----------

    async def invite(self, caller_id: uuid.UUID, callee_id: uuid.UUID, kind: CallKind) -> dict[str, Any]:
        if caller_id == callee_id:
            raise CallError("SELF_CALL", "You can't call yourself")
        if self.busy(caller_id):
            raise CallError("ALREADY_IN_CALL", "Finish your current call first")

        def check_and_log(db: Session) -> tuple[dict, dict, uuid.UUID | None, str | None]:
            caller = db.get(User, caller_id)
            callee = db.get(User, callee_id)
            if caller is None or callee is None:
                return {}, {}, None, "NOT_FOUND"
            # A block in either direction looks like "unavailable", so the
            # caller can't tell they've been blocked.
            if is_blocked_either_way(db, caller_id, callee_id):
                return {}, {}, None, "UNAVAILABLE"
            if callee.allow_calls_from == CallPermission.CONVERSATIONS and not have_shared_conversation(
                db, caller_id, callee_id
            ):
                return {}, {}, None, "NOT_ALLOWED"
            online = self.is_online(callee_id)
            log = CallLog(
                caller_id=caller_id,
                callee_id=callee_id,
                kind=kind,
                status=CallStatus.RINGING if online else CallStatus.MISSED,
                ended_at=None if online else _now(),
            )
            db.add(log)
            db.commit()
            return _public(caller), _public(callee), log.id, None if online else "OFFLINE"

        caller_pub, callee_pub, call_id, error = await self._db(check_and_log)
        messages = {
            "NOT_FOUND": "User not found",
            "UNAVAILABLE": "This user is unavailable",
            "NOT_ALLOWED": "This user only accepts calls from people they've chatted with",
            "OFFLINE": "User is offline. They'll see a missed call.",
        }
        if error:
            raise CallError(error, messages[error])
        if self.busy(callee_id):
            await self._db(lambda db: self._update_log(db, call_id, CallStatus.MISSED, ended=True))
            raise CallError("BUSY", "User is on another call")

        call = ActiveCall(id=call_id, caller_id=caller_id, callee_id=callee_id, kind=kind, caller_public=caller_pub)
        self.calls[call.id] = call
        self.user_call[caller_id] = call.id
        self.user_call[callee_id] = call.id
        call.timer = asyncio.create_task(self._ring_timeout(call.id))

        await self.emit(
            "call:incoming",
            {"call_id": str(call.id), "kind": kind.value, "caller": caller_pub},
            callee_id,
        )
        return {"call_id": str(call.id), "callee": callee_pub}

    async def accept(self, user_id: uuid.UUID, call_id: uuid.UUID) -> None:
        call = self._get(call_id, user_id)
        if user_id != call.callee_id:
            raise CallError("NOT_CALLEE", "Only the person being called can accept")
        if call.status != CallStatus.RINGING:
            raise CallError("INVALID_CALL", "This call is no longer ringing")
        call.status = CallStatus.ONGOING
        self._cancel_timer(call)

        def mark_answered(db: Session) -> tuple[User, User]:
            log = db.get(CallLog, call.id)
            log.status = CallStatus.ONGOING
            log.answered_at = _now()
            db.commit()
            return db.get(User, call.caller_id), db.get(User, call.callee_id)

        caller, callee = await self._db(mark_answered)
        room = call_room_name(call.id)
        # Each side gets its own token: same room, different identity.
        for me, peer in ((caller, callee), (callee, caller)):
            await self.emit(
                "call:accepted",
                {
                    "call_id": str(call.id),
                    "kind": call.kind.value,
                    "room": room,
                    "livekit_url": settings.livekit_url,
                    "token": create_join_token(identity=str(me.id), name=me.name, room=room),
                    "peer": _public(peer),
                },
                me.id,
            )

    async def reject(self, user_id: uuid.UUID, call_id: uuid.UUID) -> None:
        call = self._get(call_id, user_id)
        if user_id != call.callee_id:
            raise CallError("NOT_CALLEE", "Only the person being called can reject")
        if call.status != CallStatus.RINGING:
            raise CallError("INVALID_CALL", "This call is no longer ringing")
        await self._finish(call, CallStatus.REJECTED, "rejected")

    async def hangup(self, user_id: uuid.UUID, call_id: uuid.UUID) -> None:
        """End button: cancels a ringing call (caller) or ends an ongoing one (either side)."""
        call = self._get(call_id, user_id)
        if call.status == CallStatus.RINGING:
            if user_id == call.caller_id:
                await self._finish(call, CallStatus.CANCELLED, "cancelled")
            else:  # callee pressing "end" on a ringing call = reject
                await self._finish(call, CallStatus.REJECTED, "rejected")
        else:
            await self._finish(call, CallStatus.COMPLETED, "hangup")

    # ---------- presence ----------

    async def user_offline(self, user_id: uuid.UUID) -> None:
        """Called when a user's LAST socket disconnects.

        Phones drop their socket for a moment all the time (Wi-Fi handover,
        Android battery saving), so we never end a call straight away. Instead
        we start a grace timer and only finish the call if they don't return.
        While ringing, the normal ring timeout still applies on top of this.
        """
        call_id = self.user_call.get(user_id)
        if call_id is None or user_id in self._grace_timers:
            return
        self._grace_timers[user_id] = asyncio.create_task(self._grace_end(user_id, call_id))

    async def user_online(self, user_id: uuid.UUID) -> None:
        task = self._grace_timers.pop(user_id, None)
        if task:
            task.cancel()
        # If they're being called right now, the original call:incoming may
        # have been lost while they were offline, so send it again.
        call_id = self.user_call.get(user_id)
        call = self.calls.get(call_id) if call_id else None
        if call and call.status == CallStatus.RINGING and call.callee_id == user_id and call.caller_public:
            await self.emit(
                "call:incoming",
                {"call_id": str(call.id), "kind": call.kind.value, "caller": call.caller_public},
                user_id,
            )

    # ---------- internals ----------

    async def _ring_timeout(self, call_id: uuid.UUID) -> None:
        await asyncio.sleep(self.ring_timeout)
        call = self.calls.get(call_id)
        if call and call.status == CallStatus.RINGING:
            call.timer = None  # don't cancel ourselves in _finish
            await self._finish(call, CallStatus.MISSED, "no_answer")

    async def _grace_end(self, user_id: uuid.UUID, call_id: uuid.UUID) -> None:
        await asyncio.sleep(self.disconnect_grace)
        self._grace_timers.pop(user_id, None)
        call = self.calls.get(call_id)
        if call is None:
            return
        if call.status == CallStatus.RINGING:
            status = CallStatus.CANCELLED if user_id == call.caller_id else CallStatus.MISSED
        else:
            status = CallStatus.COMPLETED
        await self._finish(call, status, "disconnected")

    def _cancel_timer(self, call: ActiveCall) -> None:
        if call.timer and call.timer is not asyncio.current_task():
            call.timer.cancel()
        call.timer = None

    @staticmethod
    def _update_log(db: Session, call_id: uuid.UUID, status: CallStatus, ended: bool) -> None:
        log = db.get(CallLog, call_id)
        log.status = status
        if ended:
            log.ended_at = _now()
        db.commit()

    async def _finish(self, call: ActiveCall, status: CallStatus, reason: str) -> None:
        if self.calls.pop(call.id, None) is None:
            return  # already finished (e.g. both sides hung up at once)
        self._cancel_timer(call)
        for uid in (call.caller_id, call.callee_id):
            if self.user_call.get(uid) == call.id:
                del self.user_call[uid]
            grace = self._grace_timers.pop(uid, None)
            if grace and grace is not asyncio.current_task():
                grace.cancel()
        await self._db(lambda db: self._update_log(db, call.id, status, ended=True))
        payload = {"call_id": str(call.id), "status": status.value, "reason": reason}
        for uid in (call.caller_id, call.callee_id):
            await self.emit("call:ended", payload, uid)
