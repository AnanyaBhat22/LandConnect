"""Test setup: every test gets a fresh in-memory SQLite database.

Why SQLite for tests: tests run in about a second, offline, and never touch the
real Neon data. The models only use portable column types (Uuid, string
enums), so the same schema works on both databases.
"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models  # noqa: F401
from app.db import Base, get_db
from app.main import app


@pytest.fixture()
def client():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    TestSession = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    def override_get_db():
        db = TestSession()
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
