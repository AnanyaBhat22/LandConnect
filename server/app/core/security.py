"""Password hashing and JWT creation/verification.

- bcrypt: deliberately slow, salted hashing. A leaked database doesn't reveal passwords.
- Two token types:
    access  (short, ~60 min): sent on every request in `Authorization: Bearer ...`
    refresh (long, ~14 days): only used to get a new access token
  The `type` claim stops a refresh token being used as an access token and vice versa.
- Trade-off (documented in DECISIONS.md): tokens are stateless, so logout
  happens on the device (tokens deleted from SecureStore). Server-side
  revocation would need a token table; that's out of scope for the prototype.
"""
import uuid
from datetime import UTC, datetime, timedelta
from typing import Literal

import bcrypt
import jwt

from app.core.config import settings

ALGORITHM = "HS256"
TokenType = Literal["access", "refresh"]


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), password_hash.encode())
    except ValueError:
        return False


def create_token(user_id: uuid.UUID, role: str, token_type: TokenType) -> str:
    now = datetime.now(UTC)
    lifetime = (
        timedelta(minutes=settings.access_token_minutes)
        if token_type == "access"
        else timedelta(days=settings.refresh_token_days)
    )
    payload = {
        "sub": str(user_id),
        "role": role,
        "type": token_type,
        "iat": now,
        "exp": now + lifetime,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITHM)


class InvalidToken(Exception):
    pass


def decode_token(token: str, expected_type: TokenType) -> dict:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[ALGORITHM])
    except jwt.PyJWTError as exc:  # expired, bad signature, malformed...
        raise InvalidToken(str(exc)) from exc
    if payload.get("type") != expected_type:
        raise InvalidToken("wrong token type")
    return payload
