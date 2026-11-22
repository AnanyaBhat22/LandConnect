"""Auth, roles and privacy tests."""
from fastapi import Depends

from app.core.deps import require_role
from app.main import app
from app.models import Role
from tests.conftest import auth_header, register


# A tiny route used only in tests, to check require_role() on its own.
@app.get("/_test/sellers-only")
def _sellers_only(user=Depends(require_role(Role.SELLER, Role.BROKER))):
    return {"ok": True, "role": user.role}


def test_register_returns_tokens_and_profile(client):
    data = register(client, email="Alice@Example.com ", role="SELLER")
    assert data["access_token"] and data["refresh_token"]
    assert data["user"]["email"] == "alice@example.com"  # normalised
    assert data["user"]["role"] == "SELLER"
    assert "password_hash" not in data["user"]


def test_duplicate_email_rejected(client):
    register(client)
    res = client.post(
        "/auth/register",
        json={"name": "Again", "email": "buyer@example.com", "password": "secret123", "role": "BUYER"},
    )
    assert res.status_code == 409


def test_short_password_rejected(client):
    res = client.post(
        "/auth/register", json={"name": "X Y", "email": "x@example.com", "password": "short", "role": "BUYER"}
    )
    assert res.status_code == 422


def test_login_success_and_generic_failure(client):
    register(client)
    ok = client.post("/auth/login", json={"email": "buyer@example.com", "password": "secret123"})
    assert ok.status_code == 200
    wrong_pw = client.post("/auth/login", json={"email": "buyer@example.com", "password": "nope-nope"})
    no_user = client.post("/auth/login", json={"email": "ghost@example.com", "password": "secret123"})
    assert wrong_pw.status_code == no_user.status_code == 401
    assert wrong_pw.json()["detail"] == no_user.json()["detail"]  # no account enumeration


def test_me_requires_valid_access_token(client):
    tokens = register(client)
    assert client.get("/users/me").status_code == 401
    assert client.get("/users/me", headers={"Authorization": "Bearer garbage"}).status_code == 401
    # A refresh token must not work as an access token.
    assert client.get("/users/me", headers={"Authorization": f"Bearer {tokens['refresh_token']}"}).status_code == 401
    assert client.get("/users/me", headers=auth_header(tokens)).status_code == 200


def test_refresh_issues_new_tokens(client):
    tokens = register(client)
    res = client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert res.status_code == 200
    assert client.post("/auth/refresh", json={"refresh_token": tokens["access_token"]}).status_code == 401


def test_role_based_access(client):
    buyer = register(client, email="b@example.com", role="BUYER")
    seller = register(client, email="s@example.com", role="SELLER")
    broker = register(client, email="k@example.com", role="BROKER")
    assert client.get("/_test/sellers-only", headers=auth_header(buyer)).status_code == 403
    assert client.get("/_test/sellers-only", headers=auth_header(seller)).status_code == 200
    assert client.get("/_test/sellers-only", headers=auth_header(broker)).status_code == 200


def test_public_profile_hides_contact_details(client):
    me = register(client, email="private@example.com", phone="+919999999999")
    other = register(client, email="other@example.com")
    res = client.get(f"/users/{me['user']['id']}", headers=auth_header(other))
    assert res.status_code == 200
    body = res.json()
    assert "email" not in body and "phone" not in body
    # ...but you can see your own.
    own = client.get("/users/me", headers=auth_header(me)).json()
    assert own["phone"] == "+919999999999"


def test_update_privacy_settings_but_not_role(client):
    tokens = register(client)
    res = client.patch(
        "/users/me",
        headers=auth_header(tokens),
        json={"allow_calls_from": "CONVERSATIONS", "show_online_status": False, "role": "SELLER"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["allow_calls_from"] == "CONVERSATIONS"
    assert body["show_online_status"] is False
    assert body["role"] == "BUYER"  # role can't be self-changed


def test_block_and_unblock(client):
    a = register(client, email="a@example.com")
    b = register(client, email="b@example.com")
    b_id = b["user"]["id"]
    assert client.post(f"/users/{b_id}/block", headers=auth_header(a)).status_code == 204
    blocked = client.get("/users/blocked", headers=auth_header(a)).json()
    assert [u["id"] for u in blocked] == [b_id]
    assert client.post(f"/users/{a['user']['id']}/block", headers=auth_header(a)).status_code == 400
    assert client.delete(f"/users/{b_id}/block", headers=auth_header(a)).status_code == 204
    assert client.get("/users/blocked", headers=auth_header(a)).json() == []


def test_user_search(client):
    me = register(client, email="me@example.com")
    for name, email in (("Ravi Kumar", "ravi@example.com"), ("Ravina S", "ravina@example.com"), ("Meera", "meera@example.com")):
        client.post("/auth/register", json={"name": name, "email": email, "password": "secret123", "role": "SELLER"})
    res = client.get("/users", params={"q": "rav"}, headers=auth_header(me))
    assert res.status_code == 200
    names = [u["name"] for u in res.json()]
    assert names == ["Ravi Kumar", "Ravina S"]
    assert all("email" not in u for u in res.json())
    assert client.get("/users", params={"q": "r"}, headers=auth_header(me)).status_code == 422  # too short
