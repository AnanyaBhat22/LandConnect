"""Reusable FastAPI dependencies for authentication and role-based access.

Usage in a route:
    def create_listing(user: User = Depends(require_role(Role.SELLER, Role.BROKER))): ...

Why dependencies (not middleware): each route declares exactly what it needs,
the requirement shows up in the OpenAPI docs, and tests can override it.
The app also hides buttons by role, but THIS is the real enforcement:
a UI-only check could be bypassed by calling the API directly.
"""
import uuid
from collections.abc import Callable

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.security import InvalidToken, decode_token
from app.db import get_db
from app.models import Role, User

# auto_error=False so we can return a consistent 401 message ourselves.
bearer = HTTPBearer(auto_error=False, description="Paste the access token from /auth/login")


def _unauthorized(detail: str = "Not authenticated") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def user_from_access_token(token: str, db: Session) -> User:
    """Shared by HTTP routes and the Socket.IO connect handler."""
    try:
        payload = decode_token(token, "access")
        user_id = uuid.UUID(payload["sub"])
    except (InvalidToken, KeyError, ValueError):
        raise _unauthorized("Invalid or expired token")
    user = db.get(User, user_id)
    if user is None:
        raise _unauthorized("User no longer exists")
    return user


def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    if creds is None:
        raise _unauthorized()
    return user_from_access_token(creds.credentials, db)


def require_role(*roles: Role) -> Callable[..., User]:
    """Dependency factory: allow only the given roles, otherwise 403 Forbidden."""

    def checker(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            allowed = ", ".join(r.value.lower() for r in roles)
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Only {allowed} accounts can do this",
            )
        return user

    return checker
