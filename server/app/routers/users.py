"""Own profile, privacy settings, public profiles and blocking."""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.db import get_db
from app.models import Block, User
from app.schemas import UserMe, UserPublic, UserUpdate

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserMe)
def get_me(user: User = Depends(get_current_user)) -> User:
    return user


@router.patch("/me", response_model=UserMe)
def update_me(body: UserUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> User:
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(user, field, value)
    db.commit()
    db.refresh(user)
    return user


@router.get("/blocked", response_model=list[UserPublic])
def list_blocked(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[User]:
    return list(db.scalars(select(User).join(Block, Block.blocked_id == User.id).where(Block.blocker_id == user.id)))


@router.get("/{user_id}", response_model=UserPublic)
def get_user(user_id: uuid.UUID, _: User = Depends(get_current_user), db: Session = Depends(get_db)) -> User:
    """Public profile: name, role, avatar, bio. Never email or phone."""
    other = db.get(User, user_id)
    if other is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    return other


@router.post("/{user_id}/block", status_code=status.HTTP_204_NO_CONTENT)
def block_user(user_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> Response:
    """Blocked users can't message or call you (enforced in chat and call handlers)."""
    if user_id == user.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You can't block yourself")
    if db.get(User, user_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    if db.get(Block, (user.id, user_id)) is None:
        db.add(Block(blocker_id=user.id, blocked_id=user_id))
        db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/{user_id}/block", status_code=status.HTTP_204_NO_CONTENT)
def unblock_user(user_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> Response:
    block = db.get(Block, (user.id, user_id))
    if block is not None:
        db.delete(block)
        db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
