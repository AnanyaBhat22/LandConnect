"""Pydantic schemas: the shapes of request bodies and responses.

PRIVACY RULE: only `UserMe` (your own profile) includes email and phone.
Every other place a user appears uses `UserPublic`, which has no contact
fields at all, so a contact detail can't leak through any API response.
"""
import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.models import CallPermission, Role


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------- Users ----------

class UserPublic(ORMModel):
    id: uuid.UUID
    name: str
    role: Role
    avatar_url: str | None = None
    bio: str | None = None
    created_at: datetime


class UserMe(UserPublic):
    email: EmailStr
    phone: str | None = None
    show_online_status: bool
    allow_calls_from: CallPermission


class UserUpdate(BaseModel):
    """Fields a user may change about themselves. Role and email are fixed."""
    name: str | None = Field(default=None, min_length=2, max_length=80)
    bio: str | None = Field(default=None, max_length=300)
    avatar_url: str | None = Field(default=None, max_length=500)
    phone: str | None = Field(default=None, max_length=20)
    show_online_status: bool | None = None
    allow_calls_from: CallPermission | None = None


# ---------- Auth ----------

class RegisterIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    email: EmailStr
    # bcrypt only uses the first 72 bytes, so we cap the length explicitly.
    password: str = Field(min_length=8, max_length=72)
    role: Role
    phone: str | None = Field(default=None, max_length=20)

    @field_validator("email")
    @classmethod
    def normalise_email(cls, v: str) -> str:
        return v.strip().lower()

    @field_validator("name")
    @classmethod
    def strip_name(cls, v: str) -> str:
        return v.strip()


class LoginIn(BaseModel):
    email: EmailStr
    password: str

    @field_validator("email")
    @classmethod
    def normalise_email(cls, v: str) -> str:
        return v.strip().lower()


class RefreshIn(BaseModel):
    refresh_token: str


class AuthOut(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: UserMe
