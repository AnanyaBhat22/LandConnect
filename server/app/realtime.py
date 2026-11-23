"""Socket.IO server: authenticated realtime connection for calls (and chat next).

How a client connects (React Native):
    io(SERVER_URL, { auth: { token: accessToken }, transports: ['websocket'] })

- The same JWT access token as the REST API is checked on connect; no token, no socket.
- Each socket joins a private room "user:<id>". Emitting to that room reaches
  every device the user is signed in on, so we address people by user ID and
  never by phone number.
- Call actions are request/acknowledgement: the client calls
  socket.emitWithAck('call:invite', {...}) and gets {ok: true, ...} or
  {ok: false, code, message} back.
"""
import asyncio
import uuid
from collections import defaultdict
from typing import Any

import socketio
from fastapi import HTTPException

from app.core.deps import user_from_access_token
from app.db import SessionLocal
from app.models import CallKind
from app.services.calls import CallError, CallManager
from app.services.livekit import close_room

sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*")

# user_id -> set of socket ids (a user may have several devices connected)
presence: dict[uuid.UUID, set[str]] = defaultdict(set)


def is_online(user_id: uuid.UUID) -> bool:
    return bool(presence.get(user_id))


def user_room(user_id: uuid.UUID) -> str:
    return f"user:{user_id}"


async def emit_to_user(event: str, data: dict[str, Any], user_id: uuid.UUID) -> None:
    await sio.emit(event, data, room=user_room(user_id))


calls = CallManager(emit=emit_to_user, session_factory=SessionLocal, is_online=is_online, close_room=close_room)


async def _user_id(sid: str) -> uuid.UUID:
    session = await sio.get_session(sid)
    return uuid.UUID(session["user_id"])


def _ok(**data: Any) -> dict[str, Any]:
    return {"ok": True, **data}


def _err(code: str, message: str) -> dict[str, Any]:
    return {"ok": False, "code": code, "message": message}


def _parse_uuid(value: Any) -> uuid.UUID | None:
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError):
        return None


# ---------- connection lifecycle ----------

@sio.event
async def connect(sid: str, environ: dict, auth: dict | None = None) -> None:
    token = (auth or {}).get("token")
    if not token:
        raise socketio.exceptions.ConnectionRefusedError("unauthorized")

    def lookup() -> uuid.UUID:
        with calls.session_factory() as db:
            return user_from_access_token(token, db).id

    try:
        user_id = await asyncio.to_thread(lookup)
    except HTTPException:
        raise socketio.exceptions.ConnectionRefusedError("unauthorized")
    except Exception:
        # e.g. a brief network/DNS blip reaching the database. Refuse cleanly
        # (the client retries) instead of leaving a half-open connection.
        raise socketio.exceptions.ConnectionRefusedError("unavailable")

    await sio.save_session(sid, {"user_id": str(user_id)})
    await sio.enter_room(sid, user_room(user_id))
    first_device = not presence[user_id]
    presence[user_id].add(sid)
    if first_device:
        await calls.user_online(user_id)


@sio.event
async def disconnect(sid: str, *args: Any) -> None:
    try:
        user_id = await _user_id(sid)
    except KeyError:
        return
    presence[user_id].discard(sid)
    if not presence[user_id]:
        presence.pop(user_id, None)
        await calls.user_offline(user_id)


# ---------- chat: typing indicator ----------

@sio.on("typing")
async def typing(sid: str, data: dict | None) -> None:
    """Forward 'X is typing…' to the other participant. Fire-and-forget, never stored."""
    conv_id = _parse_uuid((data or {}).get("conversation_id"))
    if conv_id is None:
        return
    user_id = await _user_id(sid)

    def peers() -> list[uuid.UUID] | None:
        from app.services.chat import participant_ids

        with calls.session_factory() as db:
            ids = participant_ids(db, conv_id)
        return ids if user_id in ids else None

    ids = await asyncio.to_thread(peers)
    if ids is None:
        return  # not a member: silently ignore
    # The app throttles typing events (at most one every ~3 s), so this lookup is cheap.
    for uid in ids:
        if uid != user_id:
            await emit_to_user("typing", {"conversation_id": str(conv_id), "user_id": str(user_id)}, uid)


# ---------- call signalling ----------

@sio.on("call:invite")
async def call_invite(sid: str, data: dict | None) -> dict[str, Any]:
    data = data or {}
    callee_id = _parse_uuid(data.get("to"))
    try:
        kind = CallKind(str(data.get("kind", "")).upper())
    except ValueError:
        return _err("BAD_REQUEST", "kind must be AUDIO or VIDEO")
    if callee_id is None:
        return _err("BAD_REQUEST", "'to' must be a user id")
    try:
        result = await calls.invite(await _user_id(sid), callee_id, kind)
    except CallError as e:
        return _err(e.code, e.message)
    return _ok(**result)


async def _call_action(sid: str, data: dict | None, action) -> dict[str, Any]:
    call_id = _parse_uuid((data or {}).get("call_id"))
    if call_id is None:
        return _err("BAD_REQUEST", "'call_id' is required")
    try:
        await action(await _user_id(sid), call_id)
    except CallError as e:
        return _err(e.code, e.message)
    return _ok()


@sio.on("call:accept")
async def call_accept(sid: str, data: dict | None) -> dict[str, Any]:
    return await _call_action(sid, data, calls.accept)


@sio.on("call:reject")
async def call_reject(sid: str, data: dict | None) -> dict[str, Any]:
    return await _call_action(sid, data, calls.reject)


@sio.on("call:end")
async def call_end(sid: str, data: dict | None) -> dict[str, Any]:
    return await _call_action(sid, data, calls.hangup)
