"""Registration, login and token refresh."""
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import InvalidToken, create_token, decode_token, hash_password, verify_password
from app.db import get_db
from app.models import User
from app.schemas import AuthOut, LoginIn, RefreshIn, RegisterIn, UserMe

router = APIRouter(prefix="/auth", tags=["auth"])


def _auth_response(user: User) -> AuthOut:
    return AuthOut(
        access_token=create_token(user.id, user.role.value, "access"),
        refresh_token=create_token(user.id, user.role.value, "refresh"),
        user=UserMe.model_validate(user),
    )


@router.post("/register", response_model=AuthOut, status_code=status.HTTP_201_CREATED)
def register(body: RegisterIn, db: Session = Depends(get_db)) -> AuthOut:
    if db.scalar(select(User.id).where(User.email == body.email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists")
    user = User(
        name=body.name,
        email=body.email,
        password_hash=hash_password(body.password),
        role=body.role,
        phone=body.phone,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return _auth_response(user)


@router.post("/login", response_model=AuthOut)
def login(body: LoginIn, db: Session = Depends(get_db)) -> AuthOut:
    user = db.scalar(select(User).where(User.email == body.email))
    # Same message for "no such email" and "wrong password", so the login
    # form can't be used to discover which emails have accounts.
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")
    return _auth_response(user)


@router.post("/refresh", response_model=AuthOut)
def refresh(body: RefreshIn, db: Session = Depends(get_db)) -> AuthOut:
    try:
        payload = decode_token(body.refresh_token, "refresh")
        user = db.get(User, uuid.UUID(payload["sub"]))
    except (InvalidToken, KeyError, ValueError):
        user = None
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired, please log in again")
    return _auth_response(user)
