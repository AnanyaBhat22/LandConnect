"""Call history for the WhatsApp-style "Calls" tab."""
import uuid
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.db import get_db
from app.models import CallKind, CallLog, CallStatus, User
from app.schemas import UserPublic

router = APIRouter(prefix="/calls", tags=["calls"])


class CallHistoryItem(BaseModel):
    id: uuid.UUID
    kind: CallKind
    status: CallStatus
    direction: Literal["outgoing", "incoming"]
    peer: UserPublic
    created_at: datetime
    duration_seconds: int | None


@router.get("", response_model=list[CallHistoryItem])
def call_history(
    limit: int = Query(50, ge=1, le=200),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[CallHistoryItem]:
    logs = db.scalars(
        select(CallLog)
        .where(or_(CallLog.caller_id == user.id, CallLog.callee_id == user.id))
        .order_by(CallLog.created_at.desc())
        .limit(limit)
    ).all()
    peer_ids = {log.callee_id if log.caller_id == user.id else log.caller_id for log in logs}
    peers = {u.id: u for u in db.scalars(select(User).where(User.id.in_(peer_ids)))} if peer_ids else {}

    items = []
    for log in logs:
        outgoing = log.caller_id == user.id
        duration = (
            int((log.ended_at - log.answered_at).total_seconds())
            if log.answered_at and log.ended_at
            else None
        )
        items.append(
            CallHistoryItem(
                id=log.id,
                kind=log.kind,
                status=log.status,
                direction="outgoing" if outgoing else "incoming",
                peer=UserPublic.model_validate(peers[log.callee_id if outgoing else log.caller_id]),
                created_at=log.created_at,
                duration_seconds=duration,
            )
        )
    return items
