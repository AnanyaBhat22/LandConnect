"""Chat building blocks shared by the REST API and the call manager.

- One conversation per pair of users (like WhatsApp). The listing a chat was
  started from is remembered on the conversation and noted with a SYSTEM message.
- Call history appears inside the chat as CALL_LOG messages whose body is a
  small JSON payload, so each side can render it from their own perspective
  ("Missed call" for the callee, "No answer" for the caller).
"""
import json
import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session, aliased

from app.models import CallLog, CallStatus, Conversation, Message, MessageType, Participant


def find_pair_conversation(db: Session, a: uuid.UUID, b: uuid.UUID) -> Conversation | None:
    pa, pb = aliased(Participant), aliased(Participant)
    stmt = (
        select(Conversation)
        .join(pa, pa.conversation_id == Conversation.id)
        .join(pb, pb.conversation_id == Conversation.id)
        .where(pa.user_id == a, pb.user_id == b)
        .limit(1)
    )
    return db.scalar(stmt)


def get_or_create_pair_conversation(db: Session, a: uuid.UUID, b: uuid.UUID) -> tuple[Conversation, bool]:
    conv = find_pair_conversation(db, a, b)
    if conv:
        return conv, False
    conv = Conversation()
    db.add(conv)
    db.flush()
    db.add_all([Participant(conversation_id=conv.id, user_id=a), Participant(conversation_id=conv.id, user_id=b)])
    db.flush()
    return conv, True


def add_message(db: Session, conv: Conversation, sender_id: uuid.UUID | None, body: str, type: MessageType = MessageType.TEXT) -> Message:
    msg = Message(conversation_id=conv.id, sender_id=sender_id, body=body, type=type, created_at=datetime.now(UTC))
    db.add(msg)
    conv.last_message_at = msg.created_at
    db.flush()
    return msg


def participant_ids(db: Session, conversation_id: uuid.UUID) -> list[uuid.UUID]:
    return list(db.scalars(select(Participant.user_id).where(Participant.conversation_id == conversation_id)))


def unread_count(db: Session, conversation_id: uuid.UUID, user_id: uuid.UUID, last_read_at: datetime | None) -> int:
    stmt = select(func.count()).select_from(Message).where(
        Message.conversation_id == conversation_id,
        Message.sender_id != user_id,
        Message.type != MessageType.SYSTEM,
    )
    if last_read_at is not None:
        stmt = stmt.where(Message.created_at > last_read_at)
    return db.scalar(stmt) or 0


def call_log_message(db: Session, log: CallLog) -> Message | None:
    """Record a finished call in the pair's chat, if they have one."""
    conv = find_pair_conversation(db, log.caller_id, log.callee_id)
    if conv is None:
        return None
    duration = None
    if log.answered_at and log.ended_at and log.status == CallStatus.COMPLETED:
        duration = max(0, int((_aware(log.ended_at) - _aware(log.answered_at)).total_seconds()))
    body = json.dumps(
        {"kind": log.kind.value, "status": log.status.value, "caller_id": str(log.caller_id), "duration": duration}
    )
    return add_message(db, conv, log.caller_id, body, MessageType.CALL_LOG)


def _aware(dt: datetime) -> datetime:
    # SQLite (tests) returns naive datetimes; Postgres returns aware ones.
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def message_payload(msg: Message) -> dict:
    """JSON shape sent over the socket (matches the REST MessageOut schema)."""
    return {
        "id": str(msg.id),
        "conversation_id": str(msg.conversation_id),
        "sender_id": str(msg.sender_id) if msg.sender_id else None,
        "type": msg.type.value,
        "body": msg.body,
        "created_at": _aware(msg.created_at).isoformat(),
    }
