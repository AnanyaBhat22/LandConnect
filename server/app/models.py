"""All database tables in one module (small enough for a prototype to read top to bottom).

Design notes:
- Primary keys are random UUIDs, not 1, 2, 3...: IDs appear in URLs and call
  signalling, and sequential IDs would let anyone enumerate users/listings.
- Enums are stored as plain strings with a CHECK constraint (native_enum=False),
  so adding a value later is a simple migration and SQLite works in tests.
- `User.phone` is stored but never serialised by any API schema: the privacy
  rule "don't expose contact details" is enforced in one place (app/schemas.py).
"""
import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def _enum(e: type[enum.Enum]) -> Enum:
    return Enum(e, native_enum=False, length=20, validate_strings=True)


class Role(str, enum.Enum):
    BUYER = "BUYER"
    SELLER = "SELLER"
    BROKER = "BROKER"


class CallPermission(str, enum.Enum):
    EVERYONE = "EVERYONE"          # anyone logged in can call me
    CONVERSATIONS = "CONVERSATIONS"  # only people I already have a chat with


class ListingStatus(str, enum.Enum):
    ACTIVE = "ACTIVE"
    SOLD = "SOLD"
    DRAFT = "DRAFT"


class MessageType(str, enum.Enum):
    TEXT = "TEXT"
    SYSTEM = "SYSTEM"
    CALL_LOG = "CALL_LOG"
    IMAGE = "IMAGE"  # body = image URL. Stored as VARCHAR (non-native enum), so no migration was needed


class CallKind(str, enum.Enum):
    AUDIO = "AUDIO"
    VIDEO = "VIDEO"


class CallStatus(str, enum.Enum):
    RINGING = "RINGING"
    ONGOING = "ONGOING"
    COMPLETED = "COMPLETED"
    REJECTED = "REJECTED"
    MISSED = "MISSED"
    CANCELLED = "CANCELLED"  # caller hung up before an answer


def _uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(Uuid, primary_key=True, default=uuid.uuid4)


def _created_at() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = _uuid_pk()
    name: Mapped[str] = mapped_column(String(80))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[Role] = mapped_column(_enum(Role))
    phone: Mapped[str | None] = mapped_column(String(20))  # PRIVATE: never returned by the API
    avatar_url: Mapped[str | None] = mapped_column(String(500))
    bio: Mapped[str | None] = mapped_column(String(300))

    # Privacy controls
    show_online_status: Mapped[bool] = mapped_column(Boolean, default=True)
    allow_calls_from: Mapped[CallPermission] = mapped_column(
        _enum(CallPermission), default=CallPermission.EVERYONE
    )
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = _created_at()

    listings: Mapped[list["Listing"]] = relationship(back_populates="owner")


class Listing(Base):
    __tablename__ = "listings"

    id: Mapped[uuid.UUID] = _uuid_pk()
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text, default="")
    price_inr: Mapped[int] = mapped_column(BigInteger)  # whole rupees; no paise needed for land
    area_sqft: Mapped[float | None] = mapped_column(Float)
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    address: Mapped[str | None] = mapped_column(String(255))
    city: Mapped[str | None] = mapped_column(String(80), index=True)
    hide_exact_location: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[ListingStatus] = mapped_column(_enum(ListingStatus), default=ListingStatus.ACTIVE, index=True)
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    owner: Mapped[User] = relationship(back_populates="listings")
    images: Mapped[list["ListingImage"]] = relationship(
        back_populates="listing", cascade="all, delete-orphan", order_by="ListingImage.position"
    )


class ListingImage(Base):
    __tablename__ = "listing_images"

    id: Mapped[uuid.UUID] = _uuid_pk()
    listing_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("listings.id", ondelete="CASCADE"), index=True)
    url: Mapped[str] = mapped_column(String(500))
    public_id: Mapped[str | None] = mapped_column(String(255))  # Cloudinary id, so images can be deleted
    position: Mapped[int] = mapped_column(Integer, default=0)

    listing: Mapped[Listing] = relationship(back_populates="images")


class Favorite(Base):
    __tablename__ = "favorites"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    listing_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("listings.id", ondelete="CASCADE"), primary_key=True)
    created_at: Mapped[datetime] = _created_at()


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[uuid.UUID] = _uuid_pk()
    listing_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("listings.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = _created_at()
    last_message_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)

    participants: Mapped[list["Participant"]] = relationship(cascade="all, delete-orphan")


class Participant(Base):
    __tablename__ = "participants"

    conversation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True)
    last_read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[uuid.UUID] = _uuid_pk()
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), index=True
    )
    sender_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    type: Mapped[MessageType] = mapped_column(_enum(MessageType), default=MessageType.TEXT)
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = _created_at()


class MeetingRoom(Base):
    __tablename__ = "meeting_rooms"

    id: Mapped[uuid.UUID] = _uuid_pk()
    host_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    conversation_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("conversations.id", ondelete="SET NULL"))
    listing_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("listings.id", ondelete="SET NULL"))
    title: Mapped[str] = mapped_column(String(120))
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_open: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = _created_at()


class CallLog(Base):
    __tablename__ = "call_logs"

    id: Mapped[uuid.UUID] = _uuid_pk()
    caller_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    callee_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[CallKind] = mapped_column(_enum(CallKind))
    status: Mapped[CallStatus] = mapped_column(_enum(CallStatus), default=CallStatus.RINGING)
    created_at: Mapped[datetime] = _created_at()
    answered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Block(Base):
    __tablename__ = "blocks"

    blocker_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    blocked_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    created_at: Mapped[datetime] = _created_at()
