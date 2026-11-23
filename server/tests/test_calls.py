"""Unit tests for the call rules (CallManager), driven directly without sockets."""
import asyncio
import uuid

import jwt
import pytest

from app.models import Block, CallKind, CallLog, CallPermission, CallStatus, Conversation, Participant, Role, User
from app.services.calls import CallError, CallManager
from tests.conftest import TEST_LIVEKIT_SECRET


class FakeEmitter:
    def __init__(self):
        self.events: list[tuple[str, dict, uuid.UUID]] = []

    async def __call__(self, event, data, user_id):
        self.events.append((event, data, user_id))

    def to(self, user_id, event=None):
        return [d for e, d, u in self.events if u == user_id and (event is None or e == event)]


def make_user(session_factory, name, **kw) -> uuid.UUID:
    with session_factory() as db:
        user = User(name=name, email=f"{name.lower()}@example.com", password_hash="x", role=kw.pop("role", Role.BUYER), **kw)
        db.add(user)
        db.commit()
        return user.id


def setup(session_factory, online=None, ring_timeout=5.0, grace=5.0):
    emitter = FakeEmitter()
    online_set = set() if online is None else online
    mgr = CallManager(
        emit=emitter,
        session_factory=session_factory,
        is_online=lambda uid: uid in online_set,
        ring_timeout=ring_timeout,
        disconnect_grace=grace,
    )
    return mgr, emitter, online_set


def log_status(session_factory, call_id) -> CallStatus:
    with session_factory() as db:
        return db.get(CallLog, uuid.UUID(call_id)).status


def test_full_video_call_flow(session_factory):
    alice = make_user(session_factory, "Alice")
    bob = make_user(session_factory, "Bob", phone="+911234567890")

    async def scenario():
        mgr, em, online = setup(session_factory)
        online.update({alice, bob})

        res = await mgr.invite(alice, bob, CallKind.VIDEO)
        call_id = res["call_id"]
        incoming = em.to(bob, "call:incoming")
        assert incoming[0]["caller"]["name"] == "Alice"
        assert "phone" not in res["callee"] and "email" not in incoming[0]["caller"]  # privacy
        assert log_status(session_factory, call_id) == CallStatus.RINGING

        await mgr.accept(bob, uuid.UUID(call_id))
        a_acc, b_acc = em.to(alice, "call:accepted")[0], em.to(bob, "call:accepted")[0]
        assert a_acc["room"] == b_acc["room"] == f"call_{call_id}"
        assert a_acc["token"] != b_acc["token"]
        claims = jwt.decode(a_acc["token"], TEST_LIVEKIT_SECRET, algorithms=["HS256"])
        assert claims["sub"] == str(alice)
        assert claims["video"]["room"] == f"call_{call_id}"
        assert a_acc["peer"]["name"] == "Bob" and "phone" not in a_acc["peer"]
        assert log_status(session_factory, call_id) == CallStatus.ONGOING

        await mgr.hangup(alice, uuid.UUID(call_id))
        assert em.to(alice, "call:ended")[0]["status"] == "COMPLETED"
        assert em.to(bob, "call:ended")[0]["status"] == "COMPLETED"
        assert log_status(session_factory, call_id) == CallStatus.COMPLETED
        assert not mgr.calls and not mgr.user_call

    asyncio.run(scenario())


def test_reject(session_factory):
    alice, bob = make_user(session_factory, "Alice"), make_user(session_factory, "Bob")

    async def scenario():
        mgr, em, online = setup(session_factory, online=None)
        online.update({alice, bob})
        call_id = (await mgr.invite(alice, bob, CallKind.AUDIO))["call_id"]
        await mgr.reject(bob, uuid.UUID(call_id))
        assert em.to(alice, "call:ended")[0]["status"] == "REJECTED"
        assert log_status(session_factory, call_id) == CallStatus.REJECTED

    asyncio.run(scenario())


def test_only_callee_can_accept(session_factory):
    alice, bob = make_user(session_factory, "Alice"), make_user(session_factory, "Bob")

    async def scenario():
        mgr, _, online = setup(session_factory)
        online.update({alice, bob})
        call_id = uuid.UUID((await mgr.invite(alice, bob, CallKind.AUDIO))["call_id"])
        with pytest.raises(CallError) as e:
            await mgr.accept(alice, call_id)
        assert e.value.code == "NOT_CALLEE"

    asyncio.run(scenario())


def test_caller_cancels_while_ringing(session_factory):
    alice, bob = make_user(session_factory, "Alice"), make_user(session_factory, "Bob")

    async def scenario():
        mgr, em, online = setup(session_factory)
        online.update({alice, bob})
        call_id = (await mgr.invite(alice, bob, CallKind.AUDIO))["call_id"]
        await mgr.hangup(alice, uuid.UUID(call_id))
        assert em.to(bob, "call:ended")[0]["status"] == "CANCELLED"

    asyncio.run(scenario())


def test_unanswered_call_becomes_missed(session_factory):
    alice, bob = make_user(session_factory, "Alice"), make_user(session_factory, "Bob")

    async def scenario():
        mgr, em, online = setup(session_factory, ring_timeout=0.05)
        online.update({alice, bob})
        call_id = (await mgr.invite(alice, bob, CallKind.VIDEO))["call_id"]
        await asyncio.sleep(0.3)
        ended = em.to(alice, "call:ended")[0]
        assert ended["status"] == "MISSED" and ended["reason"] == "no_answer"
        assert log_status(session_factory, call_id) == CallStatus.MISSED
        assert not mgr.busy(alice) and not mgr.busy(bob)

    asyncio.run(scenario())


def test_offline_callee_gets_missed_call(session_factory):
    alice, bob = make_user(session_factory, "Alice"), make_user(session_factory, "Bob")

    async def scenario():
        mgr, em, online = setup(session_factory)
        online.add(alice)  # bob offline
        with pytest.raises(CallError) as e:
            await mgr.invite(alice, bob, CallKind.AUDIO)
        assert e.value.code == "OFFLINE"
        with session_factory() as db:
            assert db.query(CallLog).one().status == CallStatus.MISSED

    asyncio.run(scenario())


def test_busy_callee(session_factory):
    alice, bob, carol = (make_user(session_factory, n) for n in ("Alice", "Bob", "Carol"))

    async def scenario():
        mgr, _, online = setup(session_factory)
        online.update({alice, bob, carol})
        await mgr.invite(alice, bob, CallKind.AUDIO)
        with pytest.raises(CallError) as e:
            await mgr.invite(carol, bob, CallKind.AUDIO)
        assert e.value.code == "BUSY"

    asyncio.run(scenario())


def test_blocked_user_sees_unavailable(session_factory):
    alice, bob = make_user(session_factory, "Alice"), make_user(session_factory, "Bob")
    with session_factory() as db:
        db.add(Block(blocker_id=bob, blocked_id=alice))
        db.commit()

    async def scenario():
        mgr, em, online = setup(session_factory)
        online.update({alice, bob})
        with pytest.raises(CallError) as e:
            await mgr.invite(alice, bob, CallKind.AUDIO)
        assert e.value.code == "UNAVAILABLE"  # doesn't reveal the block
        assert em.events == []

    asyncio.run(scenario())


def test_calls_only_from_conversations(session_factory):
    alice = make_user(session_factory, "Alice")
    bob = make_user(session_factory, "Bob", allow_calls_from=CallPermission.CONVERSATIONS)

    async def scenario():
        mgr, _, online = setup(session_factory)
        online.update({alice, bob})
        with pytest.raises(CallError) as e:
            await mgr.invite(alice, bob, CallKind.AUDIO)
        assert e.value.code == "NOT_ALLOWED"

        with session_factory() as db:  # once they've chatted, calls are allowed
            conv = Conversation()
            db.add(conv)
            db.flush()
            db.add_all([Participant(conversation_id=conv.id, user_id=alice), Participant(conversation_id=conv.id, user_id=bob)])
            db.commit()
        assert "call_id" in await mgr.invite(alice, bob, CallKind.AUDIO)

    asyncio.run(scenario())


def test_self_call_rejected(session_factory):
    alice = make_user(session_factory, "Alice")

    async def scenario():
        mgr, _, online = setup(session_factory)
        online.add(alice)
        with pytest.raises(CallError) as e:
            await mgr.invite(alice, alice, CallKind.AUDIO)
        assert e.value.code == "SELF_CALL"

    asyncio.run(scenario())


def test_callee_disconnects_while_ringing(session_factory):
    alice, bob = make_user(session_factory, "Alice"), make_user(session_factory, "Bob")

    async def scenario():
        mgr, em, online = setup(session_factory, grace=0.1)
        online.update({alice, bob})
        await mgr.invite(alice, bob, CallKind.AUDIO)
        await mgr.user_offline(bob)
        assert em.to(alice, "call:ended") == []  # still ringing during the grace period
        await asyncio.sleep(0.25)
        ended = em.to(alice, "call:ended")[0]
        assert ended["status"] == "MISSED" and ended["reason"] == "disconnected"

    asyncio.run(scenario())


def test_callee_reconnects_while_ringing_gets_alert_again(session_factory):
    """Phones drop their socket briefly (battery saving); the call must survive
    and the incoming-call screen must reappear when they reconnect."""
    alice, bob = make_user(session_factory, "Alice"), make_user(session_factory, "Bob")

    async def scenario():
        mgr, em, online = setup(session_factory, grace=0.1)
        online.update({alice, bob})
        call_id = (await mgr.invite(alice, bob, CallKind.VIDEO))["call_id"]
        assert len(em.to(bob, "call:incoming")) == 1

        await mgr.user_offline(bob)
        await mgr.user_online(bob)
        incoming = em.to(bob, "call:incoming")
        assert len(incoming) == 2 and incoming[1]["call_id"] == call_id
        assert incoming[1]["caller"]["name"] == "Alice"

        await asyncio.sleep(0.25)  # past the grace period: call still alive
        assert em.to(alice, "call:ended") == []
        await mgr.reject(bob, uuid.UUID(call_id))
        assert em.to(alice, "call:ended")[0]["status"] == "REJECTED"

    asyncio.run(scenario())


def test_ongoing_call_survives_brief_disconnect(session_factory):
    alice, bob = make_user(session_factory, "Alice"), make_user(session_factory, "Bob")

    async def scenario():
        mgr, em, online = setup(session_factory, grace=0.1)
        online.update({alice, bob})
        call_id = uuid.UUID((await mgr.invite(alice, bob, CallKind.VIDEO))["call_id"])
        await mgr.accept(bob, call_id)

        await mgr.user_offline(bob)  # network blip...
        await mgr.user_online(bob)   # ...back within the grace period
        await asyncio.sleep(0.25)
        assert em.to(alice, "call:ended") == []

        await mgr.user_offline(bob)  # gone for good
        await asyncio.sleep(0.25)
        assert em.to(alice, "call:ended")[0]["reason"] == "disconnected"

    asyncio.run(scenario())
