"""Meeting rooms: who can create, who can join, ending, invites and privacy."""
import jwt
import pytest

from app import realtime
from app.routers import meetings as meetings_router
from tests.conftest import TEST_LIVEKIT_SECRET, auth_header, register


@pytest.fixture(autouse=True)
def no_external_calls(monkeypatch):
    closed: list[str] = []
    sent: list[tuple[str, dict, str]] = []

    async def fake_close(room):
        closed.append(room)

    async def fake_emit(event, data, uid):
        sent.append((event, data, str(uid)))

    monkeypatch.setattr(meetings_router, "close_room", fake_close)
    monkeypatch.setattr(realtime, "emit_to_user", fake_emit)
    return closed, sent


def users(client):
    ravi = register(client, email="ravi@example.com", role="SELLER")
    asha = register(client, email="asha@example.com", role="BUYER")
    meera = register(client, email="meera@example.com", role="BROKER")
    eve = register(client, email="eve@example.com", role="BUYER")
    return ravi, asha, meera, eve


def create(client, host, invitees, title="Site discussion"):
    res = client.post("/meetings", json={"title": title, "invitee_ids": [u["user"]["id"] for u in invitees]}, headers=auth_header(host))
    assert res.status_code == 201, res.text
    return res.json()


def test_only_sellers_and_brokers_create(client):
    ravi, asha, meera, _ = users(client)
    assert client.post("/meetings", json={"title": "Hi there"}, headers=auth_header(asha)).status_code == 403
    m = create(client, ravi, [asha, meera])
    assert m["is_host"] is True and {u["id"] for u in m["invitees"]} == {asha["user"]["id"], meera["user"]["id"]}
    assert all("email" not in u for u in m["invitees"])


def test_join_rules_and_tokens(client):
    ravi, asha, meera, eve = users(client)
    m = create(client, ravi, [asha])
    url = f"/meetings/{m['id']}/join"

    joined = client.post(url, headers=auth_header(asha))
    assert joined.status_code == 200
    claims = jwt.decode(joined.json()["token"], TEST_LIVEKIT_SECRET, algorithms=["HS256"])
    assert claims["sub"] == asha["user"]["id"] and claims["video"]["room"] == f"meeting_{m['id']}"
    assert client.post(url, headers=auth_header(ravi)).status_code == 200  # host
    assert client.post(url, headers=auth_header(eve)).status_code == 404  # not invited


def test_list_shows_hosted_and_invited_only(client):
    ravi, asha, meera, eve = users(client)
    m = create(client, ravi, [asha])
    assert [x["id"] for x in client.get("/meetings", headers=auth_header(asha)).json()] == [m["id"]]
    assert client.get("/meetings", headers=auth_header(asha)).json()[0]["is_host"] is False
    assert client.get("/meetings", headers=auth_header(eve)).json() == []


def test_end_meeting(client, no_external_calls):
    closed, sent = no_external_calls
    ravi, asha, *_ = users(client)
    m = create(client, ravi, [asha])
    assert client.post(f"/meetings/{m['id']}/end", headers=auth_header(asha)).status_code == 403  # only host
    res = client.post(f"/meetings/{m['id']}/end", headers=auth_header(ravi))
    assert res.status_code == 200 and res.json()["is_open"] is False
    assert closed == [f"meeting_{m['id']}"]
    assert client.post(f"/meetings/{m['id']}/join", headers=auth_header(asha)).status_code == 410
    assert any(e == "meeting:ended" and uid == asha["user"]["id"] for e, _, uid in sent)


def test_invite_posts_chat_note_and_push(client, no_external_calls):
    _, sent = no_external_calls
    ravi, asha, *_ = users(client)
    create(client, ravi, [asha], title="Plot walkthrough")
    conv = client.get("/conversations", headers=auth_header(asha)).json()[0]
    assert conv["peer"]["id"] == ravi["user"]["id"]
    assert "Plot walkthrough" in conv["last_message"]["body"]
    assert any(e == "meeting:invited" and uid == asha["user"]["id"] for e, _, uid in sent)


def test_blocked_users_are_not_invited(client):
    ravi, asha, *_ = users(client)
    client.post(f"/users/{ravi['user']['id']}/block", headers=auth_header(asha))
    m = create(client, ravi, [asha])
    assert m["invitees"] == []
    assert client.post(f"/meetings/{m['id']}/join", headers=auth_header(asha)).status_code == 404
