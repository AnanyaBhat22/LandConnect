"""Meeting rooms: group video calls for sellers/brokers and the people they invite.

Roles (from the plan's permission table): sellers and brokers create meetings,
anyone can join a meeting they were invited to. The server is the gatekeeper:
a LiveKit token for room "meeting_<id>" is only issued to the host or an
invitee, and only while the meeting is open. Ending a meeting closes the
LiveKit room, which disconnects everyone.
"""
import uuid
from datetime import datetime

from anyio.from_thread import run as run_async
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app import realtime
from app.core.config import settings
from app.core.deps import get_current_user, require_role
from app.db import get_db
from app.models import Listing, MeetingInvite, MeetingRoom, MessageType, Role, User
from app.schemas import UserPublic
from app.services import chat as chat_service
from app.services.calls import is_blocked_either_way
from app.services.livekit import close_room, create_join_token, meeting_room_name

router = APIRouter(prefix="/meetings", tags=["meetings"])


class MeetingCreate(BaseModel):
    title: str = Field(min_length=3, max_length=120)
    listing_id: uuid.UUID | None = None
    scheduled_at: datetime | None = None
    invitee_ids: list[uuid.UUID] = Field(default_factory=list, max_length=20)


class MeetingOut(BaseModel):
    id: uuid.UUID
    title: str
    host: UserPublic
    invitees: list[UserPublic]
    listing_id: uuid.UUID | None
    listing_title: str | None
    scheduled_at: datetime | None
    is_open: bool
    is_host: bool
    created_at: datetime


class JoinOut(BaseModel):
    room: str
    livekit_url: str
    token: str


def _push(event: str, data: dict, user_ids: list[uuid.UUID]) -> None:
    for uid in user_ids:
        try:
            run_async(realtime.emit_to_user, event, data, uid)
        except Exception:  # noqa: BLE001 - a push failure must never fail the request
            pass


def _invitee_ids(db: Session, meeting_id: uuid.UUID) -> list[uuid.UUID]:
    return list(db.scalars(select(MeetingInvite.user_id).where(MeetingInvite.meeting_id == meeting_id)))


def _out(db: Session, m: MeetingRoom, viewer: User) -> MeetingOut:
    invitees = db.scalars(select(User).where(User.id.in_(_invitee_ids(db, m.id)))).all()
    listing = db.get(Listing, m.listing_id) if m.listing_id else None
    return MeetingOut(
        id=m.id,
        title=m.title,
        host=UserPublic.model_validate(db.get(User, m.host_id)),
        invitees=[UserPublic.model_validate(u) for u in invitees],
        listing_id=m.listing_id,
        listing_title=listing.title if listing else None,
        scheduled_at=m.scheduled_at,
        is_open=m.is_open,
        is_host=m.host_id == viewer.id,
        created_at=m.created_at,
    )


def _load_member(db: Session, meeting_id: uuid.UUID, user: User) -> MeetingRoom:
    m = db.get(MeetingRoom, meeting_id)
    if m is None or (m.host_id != user.id and user.id not in _invitee_ids(db, m.id)):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Meeting not found")
    return m


@router.post("", response_model=MeetingOut, status_code=status.HTTP_201_CREATED)
def create_meeting(
    body: MeetingCreate,
    user: User = Depends(require_role(Role.SELLER, Role.BROKER)),
    db: Session = Depends(get_db),
) -> MeetingOut:
    if body.listing_id and db.get(Listing, body.listing_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Listing not found")
    invitees = []
    for uid in dict.fromkeys(body.invitee_ids):  # de-duplicate, keep order
        if uid == user.id:
            continue
        other = db.get(User, uid)
        # Unknown or blocked users are skipped silently (no way to probe who blocked you).
        if other is not None and not is_blocked_either_way(db, user.id, uid):
            invitees.append(other)

    m = MeetingRoom(host_id=user.id, title=body.title.strip(), listing_id=body.listing_id, scheduled_at=body.scheduled_at)
    db.add(m)
    db.flush()
    notes = []
    for other in invitees:
        db.add(MeetingInvite(meeting_id=m.id, user_id=other.id))
        # Tell each invitee in their chat with the host, so it shows up where they already look.
        conv, _ = chat_service.get_or_create_pair_conversation(db, user.id, other.id)
        note = chat_service.add_message(db, conv, None, f"{user.name} invited you to a meeting: {m.title}. Open Calls → Meetings to join.", MessageType.SYSTEM)
        notes.append((note, other.id))
    db.commit()
    for note, uid in notes:
        payload = chat_service.message_payload(note)
        _push("message:new", payload, [user.id, uid])
        _push("meeting:invited", {"meeting_id": str(m.id), "title": m.title, "host": user.name}, [uid])
    return _out(db, m, user)


@router.get("", response_model=list[MeetingOut])
def list_meetings(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[MeetingOut]:
    invited = select(MeetingInvite.meeting_id).where(MeetingInvite.user_id == user.id)
    rows = db.scalars(
        select(MeetingRoom)
        .where(or_(MeetingRoom.host_id == user.id, MeetingRoom.id.in_(invited)))
        .order_by(MeetingRoom.is_open.desc(), MeetingRoom.created_at.desc())
    ).all()
    return [_out(db, m, user) for m in rows]


@router.post("/{meeting_id}/join", response_model=JoinOut)
def join_meeting(meeting_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> JoinOut:
    m = _load_member(db, meeting_id, user)
    if not m.is_open:
        raise HTTPException(status.HTTP_410_GONE, "This meeting has ended")
    room = meeting_room_name(m.id)
    return JoinOut(room=room, livekit_url=settings.livekit_url, token=create_join_token(identity=str(user.id), name=user.name, room=room))


@router.post("/{meeting_id}/end", response_model=MeetingOut)
def end_meeting(meeting_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> MeetingOut:
    m = _load_member(db, meeting_id, user)
    if m.host_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the host can end the meeting")
    m.is_open = False
    db.commit()
    try:
        run_async(close_room, meeting_room_name(m.id))  # disconnects everyone still in the room
    except Exception:  # noqa: BLE001
        pass
    _push("meeting:ended", {"meeting_id": str(m.id)}, [m.host_id, *_invitee_ids(db, m.id)])
    return _out(db, m, user)
