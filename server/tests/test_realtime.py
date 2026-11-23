"""End-to-end test: a real server on a local port, two real Socket.IO clients.

This exercises everything the phone will use: REST login, socket auth,
call:invite → call:incoming → call:accept → call:accepted → call:end → call:ended,
plus the call history endpoint.
"""
import asyncio
import socket
import threading
import time

import httpx
import pytest
import socketio
import uvicorn

from app import realtime
from app.db import get_db
from app.main import app, asgi


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture()
def live_server(session_factory, monkeypatch):
    def override_get_db():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    monkeypatch.setattr(realtime.calls, "session_factory", session_factory)
    monkeypatch.setattr(realtime.calls, "ring_timeout", 5.0)
    monkeypatch.setattr(realtime.calls, "close_room", None)  # never call LiveKit from tests

    port = _free_port()
    server = uvicorn.Server(uvicorn.Config(asgi, host="127.0.0.1", port=port, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    for _ in range(100):
        if server.started:
            break
        time.sleep(0.05)
    yield f"http://127.0.0.1:{port}"
    server.should_exit = True
    thread.join(timeout=5)
    app.dependency_overrides.clear()


def _register(base: str, name: str) -> dict:
    res = httpx.post(
        f"{base}/auth/register",
        json={"name": name, "email": f"{name.lower()}@example.com", "password": "secret123", "role": "BUYER"},
    )
    assert res.status_code == 201, res.text
    return res.json()


def test_socket_rejects_missing_or_bad_token(live_server):
    async def scenario():
        for auth in (None, {"token": "garbage"}):
            sio = socketio.AsyncClient()
            with pytest.raises(socketio.exceptions.ConnectionError):
                await sio.connect(live_server, auth=auth, transports=["websocket"], wait_timeout=5)

    asyncio.run(scenario())


def test_call_flow_over_sockets(live_server):
    alice = _register(live_server, "Alice")
    bob = _register(live_server, "Bob")

    async def scenario():
        a, b = socketio.AsyncClient(), socketio.AsyncClient()
        got: dict[str, asyncio.Queue] = {k: asyncio.Queue() for k in ("b_incoming", "a_accepted", "b_accepted", "a_ended", "b_ended")}
        b.on("call:incoming", lambda d: got["b_incoming"].put_nowait(d))
        a.on("call:accepted", lambda d: got["a_accepted"].put_nowait(d))
        b.on("call:accepted", lambda d: got["b_accepted"].put_nowait(d))
        a.on("call:ended", lambda d: got["a_ended"].put_nowait(d))
        b.on("call:ended", lambda d: got["b_ended"].put_nowait(d))

        await a.connect(live_server, auth={"token": alice["access_token"]}, transports=["websocket"])
        await b.connect(live_server, auth={"token": bob["access_token"]}, transports=["websocket"])

        bad = await a.call("call:invite", {"to": "not-a-uuid", "kind": "VIDEO"})
        assert bad["ok"] is False and bad["code"] == "BAD_REQUEST"

        res = await a.call("call:invite", {"to": bob["user"]["id"], "kind": "VIDEO"})
        assert res["ok"], res
        call_id = res["call_id"]

        incoming = await asyncio.wait_for(got["b_incoming"].get(), 5)
        assert incoming["call_id"] == call_id and incoming["caller"]["name"] == "Alice"

        assert (await b.call("call:accept", {"call_id": call_id}))["ok"]
        a_acc = await asyncio.wait_for(got["a_accepted"].get(), 5)
        b_acc = await asyncio.wait_for(got["b_accepted"].get(), 5)
        assert a_acc["room"] == b_acc["room"] and a_acc["token"] != b_acc["token"]

        assert (await a.call("call:end", {"call_id": call_id}))["ok"]
        assert (await asyncio.wait_for(got["a_ended"].get(), 5))["status"] == "COMPLETED"
        assert (await asyncio.wait_for(got["b_ended"].get(), 5))["status"] == "COMPLETED"

        # Ending again is a harmless, explained error.
        again = await a.call("call:end", {"call_id": call_id})
        assert again == {"ok": False, "code": "INVALID_CALL", "message": "This call has already ended"}

        await a.disconnect()
        await b.disconnect()
        return call_id

    call_id = asyncio.run(scenario())

    history = httpx.get(
        f"{live_server}/calls", headers={"Authorization": f"Bearer {bob['access_token']}"}
    ).json()
    assert history[0]["id"] == call_id
    assert history[0]["direction"] == "incoming"
    assert history[0]["status"] == "COMPLETED"
    assert history[0]["peer"]["name"] == "Alice"
    assert "phone" not in history[0]["peer"]
