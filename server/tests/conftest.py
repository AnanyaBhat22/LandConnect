"""Test setup: every test gets a fresh in-memory SQLite database.

Why SQLite for tests: tests run in seconds, offline, and never touch the
real Neon data. The models only use portable column types (Uuid, string
enums), so the same schema works on both databases.
"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models  # noqa: F401
from app.core.config import settings
from app.db import Base, get_db
from app.main import app

TEST_LIVEKIT_KEY = "test-api-key"
TEST_LIVEKIT_SECRET = "test-api-secret-that-is-long-enough-123456"


@pytest.fixture(autouse=True)
def fake_livekit_settings(monkeypatch):
    """Tests never use the real LiveKit project keys."""
    monkeypatch.setattr(settings, "livekit_api_key", TEST_LIVEKIT_KEY)
    monkeypatch.setattr(settings, "livekit_api_secret", TEST_LIVEKIT_SECRET)
    monkeypatch.setattr(settings, "livekit_url", "wss://test.livekit.cloud")


@pytest.fixture()
def session_factory():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


@pytest.fixture()
def client(session_factory):
    def override_get_db():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def register(client, email="buyer@example.com", role="BUYER", password="secret123", phone=None):
    res = client.post(
        "/auth/register",
        json={"name": "Test User", "email": email, "password": password, "role": role, "phone": phone},
    )
    assert res.status_code == 201, res.text
    return res.json()


def auth_header(tokens: dict) -> dict:
    return {"Authorization": f"Bearer {tokens['access_token']}"}
