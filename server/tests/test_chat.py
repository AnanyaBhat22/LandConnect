"""Chat: one conversation per pair, membership, blocking, unread/read, pushes, call logs."""
import asyncio
import json
import uuid

import pytest

from app import realtime
from app.models import CallKind
from app.services.calls import CallManager
from tests.conftest import auth_header, register


@pytest.fixture()
def pushes(monkeypatch):
    """Capture socket pushes instead of emitting them."""
    sent: list[tuple[str, dict, str]] = []

    async def fake_emit(event, data, user_id):
        sent.append((event, data, str(user_id)))

    monkeypatch.setattr(realtime, "emit_to_user", fake_emit)
    return sent


def start(client, me, other_id, listing_id=None):
    res = client.post("/conversations", json={"user_id": other_id, "listing_id": listing_id}, headers=auth_header(me))
    assert res.status_code == 200, res.text
    return res.json()


def test_one_conversation_per_pair_and_privacy(client, pushes):
    asha = register(client, email="asha@example.com")
    ravi = register(client, email="ravi@example.com", role="SELLER", phone="+911111111111")
    c1 = start(client, asha, ravi["user"]["id"])
    c2 = start(client, ravi, asha["user"]["id"])  # other direction → same chat
    assert c1["id"] == c2["id"]
    assert c1["peer"]["id"] == ravi["user"]["id"]
    assert "phone" not in c1["peer"] and "email" not in c1["peer"]
    assert client.post("/conversations", json={"user_id": asha["user"]["id"]}, headers=auth_header(asha)).status_code == 400


def test_send_list_and_push(client, pushes):
    asha = register(client, email="asha@example.com")
    ravi = register(client, email="ravi@example.com", role="SELLER")
    conv = start(client, asha, ravi["user"]["id"])
    url = f"/conversations/{conv['id']}/messages"

    res = client.post(url, json={"body": "  Is the plot still available?  "}, headers=auth_header(asha))
    assert res.status_code == 201 and res.json()["body"] == "Is the plot still available?"
    client.post(url, json={"body": "Yes, it is."}, headers=auth_header(ravi))

    msgs = client.get(url, headers=auth_header(asha)).json()
    assert [m["body"] for m in msgs] == ["Is the plot still available?", "Yes, it is."]  # oldest first
    pushed = [(e, d["body"], uid) for e, d, uid in pushes if e == "message:new"]
    assert ("message:new", "Yes, it is.", asha["user"]["id"]) in pushed  # delivered to the other side live
    assert client.post(url, json={"body": "   "}, headers=auth_header(asha)).status_code == 422


def test_outsider_cannot_read_or_send(client, pushes):
    asha = register(client, email="asha@example.com")
    ravi = register(client, email="ravi@example.com", role="SELLER")
    eve = register(client, email="eve@example.com")
    conv = start(client, asha, ravi["user"]["id"])
    assert client.get(f"/conversations/{conv['id']}/messages", headers=auth_header(eve)).status_code == 404
    assert client.post(f"/conversations/{conv['id']}/messages", json={"body": "hi"}, headers=auth_header(eve)).status_code == 404


def test_blocking_stops_chat(client, pushes):
    asha = register(client, email="asha@example.com")
    ravi = register(client, email="ravi@example.com", role="SELLER")
    conv = start(client, asha, ravi["user"]["id"])
    client.post(f"/users/{asha['user']['id']}/block", headers=auth_header(ravi))
    assert client.post(f"/conversations/{conv['id']}/messages", json={"body": "hello?"}, headers=auth_header(asha)).status_code == 403
    assert client.post("/conversations", json={"user_id": ravi["user"]["id"]}, headers=auth_header(asha)).status_code == 403


def test_unread_and_read_receipts(client, pushes):
    asha = register(client, email="asha@example.com")
    ravi = register(client, email="ravi@example.com", role="SELLER")
    conv = start(client, asha, ravi["user"]["id"])
    for text in ("Hi", "Price negotiable?"):
        client.post(f"/conversations/{conv['id']}/messages", json={"body": text}, headers=auth_header(asha))

    assert client.get("/conversations/unread-count", headers=auth_header(ravi)).json() == {"unread": 2}
    assert client.get("/conversations/unread-count", headers=auth_header(asha)).json() == {"unread": 0}
    listing = client.get("/conversations", headers=auth_header(ravi)).json()[0]
    assert listing["unread"] == 2 and listing["last_message"]["body"] == "Price negotiable?"

    assert client.post(f"/conversations/{conv['id']}/read", headers=auth_header(ravi)).status_code == 204
    assert client.get("/conversations/unread-count", headers=auth_header(ravi)).json() == {"unread": 0}
    assert any(e == "conversation:read" and uid == asha["user"]["id"] for e, _, uid in pushes)
    assert client.get(f"/conversations/{conv['id']}", headers=auth_header(asha)).json()["peer_last_read_at"] is not None


def test_chat_started_from_listing_notes_it(client, pushes):
    asha = register(client, email="asha@example.com")
    ravi = register(client, email="ravi@example.com", role="SELLER")
    listing = client.post(
        "/listings",
        json={"title": "Plot near Pune", "price_inr": 1000000, "latitude": 18.5, "longitude": 73.8},
        headers=auth_header(ravi),
    ).json()
    conv = start(client, asha, ravi["user"]["id"], listing["id"])
    assert conv["listing"]["title"] == "Plot near Pune"
    msgs = client.get(f"/conversations/{conv['id']}/messages", headers=auth_header(asha)).json()
    assert msgs[0]["type"] == "SYSTEM" and "Plot near Pune" in msgs[0]["body"]
    start(client, asha, ravi["user"]["id"], listing["id"])  # same listing again: no duplicate note
    assert len(client.get(f"/conversations/{conv['id']}/messages", headers=auth_header(asha)).json()) == 1


def test_finished_call_appears_in_chat(client, session_factory, pushes):
    asha = register(client, email="asha@example.com")
    ravi = register(client, email="ravi@example.com", role="SELLER")
    conv = start(client, asha, ravi["user"]["id"])
    a, r = uuid.UUID(asha["user"]["id"]), uuid.UUID(ravi["user"]["id"])
    emitted = []

    async def emit(event, data, uid):
        emitted.append((event, data, uid))

    async def scenario():
        mgr = CallManager(emit=emit, session_factory=session_factory, is_online=lambda u: True, ring_timeout=0.05)
        await mgr.invite(a, r, CallKind.VIDEO)
        await asyncio.sleep(0.3)  # unanswered → MISSED

    asyncio.run(scenario())
    msgs = client.get(f"/conversations/{conv['id']}/messages", headers=auth_header(asha)).json()
    assert msgs[-1]["type"] == "CALL_LOG"
    log = json.loads(msgs[-1]["body"])
    assert log == {"kind": "VIDEO", "status": "MISSED", "caller_id": str(a), "duration": None}
    assert {uid for e, _, uid in emitted if e == "message:new"} == {a, r}
