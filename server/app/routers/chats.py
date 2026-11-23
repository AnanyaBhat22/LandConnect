"""Conversations and messages.

Sending is a normal REST call (validated, stored, easy to retry), and the
server then pushes `message:new` to every device of both participants over
Socket.IO, so the other person sees it instantly without polling.
"""
import uuid
from datetime import UTC, datetime

from anyio.from_thread import run as run_async
from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import realtime
from app.core.deps import get_current_user
from app.db import get_db
from app.models import Conversation, Listing, Message, MessageType, Participant, User
from app.schemas import ORMModel, UserPublic
from app.services import chat as chat_service
from app.services import images as image_store
from app.services.calls import is_blocked_either_way

router = APIRouter(prefix="/conversations", tags=["chat"])


class StartChatIn(BaseModel):
    user_id: uuid.UUID
    listing_id: uuid.UUID | None = None


class SendIn(BaseModel):
    body: str = Field(min_length=1, max_length=4000)


class MessageOut(ORMModel):
    id: uuid.UUID
    conversation_id: uuid.UUID
    sender_id: uuid.UUID | None
    type: MessageType
    body: str
    created_at: datetime


class ListingBrief(BaseModel):
    id: uuid.UUID
    title: str
    price_inr: int
    city: str | None
    image_url: str | None


class ConversationOut(BaseModel):
    id: uuid.UUID
    peer: UserPublic
    peer_online: bool | None  # None when the peer hides their online status
    peer_last_read_at: datetime | None  # for read ticks on my messages
    listing: ListingBrief | None
    last_message: MessageOut | None
    unread: int
    updated_at: datetime


def _push(event: str, data: dict, user_ids: list[uuid.UUID]) -> None:
    """Emit to sockets from a sync endpoint (FastAPI runs it in a worker thread)."""
    for uid in user_ids:
        try:
            run_async(realtime.emit_to_user, event, data, uid)
        except Exception:  # noqa: BLE001 - a push failure must never fail the request
            pass


def _membership(db: Session, conversation_id: uuid.UUID, user: User) -> tuple[Conversation, Participant, Participant]:
    conv = db.get(Conversation, conversation_id)
    parts = db.scalars(select(Participant).where(Participant.conversation_id == conversation_id)).all() if conv else []
    me = next((p for p in parts if p.user_id == user.id), None)
    if conv is None or me is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found")
    peer = next(p for p in parts if p.user_id != user.id)
    return conv, me, peer


def _listing_brief(db: Session, listing_id: uuid.UUID | None) -> ListingBrief | None:
    if listing_id is None:
        return None
    listing = db.get(Listing, listing_id)
    if listing is None:
        return None
    return ListingBrief(
        id=listing.id,
        title=listing.title,
        price_inr=listing.price_inr,
        city=listing.city,
        image_url=listing.images[0].url if listing.images else None,
    )


def _conversation_out(db: Session, conv: Conversation, me: Participant, peer_part: Participant) -> ConversationOut:
    peer = db.get(User, peer_part.user_id)
    last = db.scalar(select(Message).where(Message.conversation_id == conv.id).order_by(Message.created_at.desc()).limit(1))
    return ConversationOut(
        id=conv.id,
        peer=UserPublic.model_validate(peer),
        peer_online=realtime.is_online(peer.id) if peer.show_online_status else None,
        peer_last_read_at=peer_part.last_read_at,
        listing=_listing_brief(db, conv.listing_id),
        last_message=MessageOut.model_validate(last) if last else None,
        unread=chat_service.unread_count(db, conv.id, me.user_id, me.last_read_at),
        updated_at=conv.last_message_at or conv.created_at,
    )


@router.get("", response_model=list[ConversationOut])
def list_conversations(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[ConversationOut]:
    mine = db.scalars(select(Participant).where(Participant.user_id == user.id)).all()
    out = []
    for me in mine:
        conv, me, peer = _membership(db, me.conversation_id, user)
        out.append(_conversation_out(db, conv, me, peer))
    out.sort(key=lambda c: c.updated_at, reverse=True)
    return out


@router.get("/unread-count")
def unread_total(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict[str, int]:
    """Total unread messages, for the badge on the Chats tab."""
    mine = db.scalars(select(Participant).where(Participant.user_id == user.id)).all()
    return {"unread": sum(chat_service.unread_count(db, p.conversation_id, user.id, p.last_read_at) for p in mine)}


@router.post("", response_model=ConversationOut)
def start_conversation(body: StartChatIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> ConversationOut:
    """Open (or reuse) the chat with another user, optionally about a listing."""
    if body.user_id == user.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You can't chat with yourself")
    other = db.get(User, body.user_id)
    if other is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    if is_blocked_either_way(db, user.id, other.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This user is unavailable")

    conv, _ = chat_service.get_or_create_pair_conversation(db, user.id, other.id)
    if body.listing_id and body.listing_id != conv.listing_id:
        listing = db.get(Listing, body.listing_id)
        if listing is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Listing not found")
        conv.listing_id = listing.id
        note = chat_service.add_message(db, conv, None, f"About: {listing.title}", MessageType.SYSTEM)
        db.commit()
        _push("message:new", chat_service.message_payload(note), [user.id, other.id])
    else:
        db.commit()
    conv, me, peer = _membership(db, conv.id, user)
    return _conversation_out(db, conv, me, peer)


@router.get("/{conversation_id}", response_model=ConversationOut)
def get_conversation(conversation_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> ConversationOut:
    conv, me, peer = _membership(db, conversation_id, user)
    return _conversation_out(db, conv, me, peer)


@router.get("/{conversation_id}/messages", response_model=list[MessageOut])
def list_messages(
    conversation_id: uuid.UUID,
    before: datetime | None = Query(None, description="Load older messages before this time"),
    limit: int = Query(50, ge=1, le=200),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[Message]:
    _membership(db, conversation_id, user)
    stmt = select(Message).where(Message.conversation_id == conversation_id)
    if before:
        stmt = stmt.where(Message.created_at < before)
    newest_first = db.scalars(stmt.order_by(Message.created_at.desc()).limit(limit)).all()
    return list(reversed(newest_first))  # oldest → newest for display


@router.post("/{conversation_id}/messages", response_model=MessageOut, status_code=status.HTTP_201_CREATED)
def send_message(conversation_id: uuid.UUID, body: SendIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> Message:
    conv, me, peer = _membership(db, conversation_id, user)
    if is_blocked_either_way(db, user.id, peer.user_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can't message this user")
    text = body.body.strip()
    if not text:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Message is empty")
    msg = chat_service.add_message(db, conv, user.id, text)
    me.last_read_at = msg.created_at  # my own message means I've seen everything before it
    db.commit()
    db.refresh(msg)
    _push("message:new", chat_service.message_payload(msg), [user.id, peer.user_id])
    return msg


@router.post("/{conversation_id}/images", response_model=MessageOut, status_code=status.HTTP_201_CREATED)
def send_image(
    conversation_id: uuid.UUID,
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Message:
    """Send a picture: checked like listing photos, stored on Cloudinary, sent as an IMAGE message."""
    conv, me, peer = _membership(db, conversation_id, user)
    if is_blocked_either_way(db, user.id, peer.user_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can't message this user")
    if file.content_type not in image_store.ALLOWED_TYPES:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Send a JPEG, PNG, WebP or HEIC photo")
    data = file.file.read(image_store.MAX_BYTES + 1)
    if len(data) > image_store.MAX_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Photo is larger than 8 MB")
    try:
        stored = image_store.upload_chat_image(data, str(conv.id))
    except Exception:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Photo upload failed, please try again")
    msg = chat_service.add_message(db, conv, user.id, stored.url, MessageType.IMAGE)
    me.last_read_at = msg.created_at
    db.commit()
    db.refresh(msg)
    _push("message:new", chat_service.message_payload(msg), [user.id, peer.user_id])
    return msg


@router.post("/{conversation_id}/read", status_code=status.HTTP_204_NO_CONTENT)
def mark_read(conversation_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> Response:
    _, me, peer = _membership(db, conversation_id, user)
    me.last_read_at = datetime.now(UTC)
    db.commit()
    # Lets the sender's app turn ✓ into ✓✓ (read).
    _push("conversation:read", {"conversation_id": str(conversation_id), "user_id": str(user.id), "at": me.last_read_at.isoformat()}, [peer.user_id])
    return Response(status_code=status.HTTP_204_NO_CONTENT)
