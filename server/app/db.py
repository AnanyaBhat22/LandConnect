"""Database engine, session factory and the declarative Base for all models.

Why sync SQLAlchemy (not async): it's simpler to read and explain, FastAPI runs
sync endpoints in a thread pool, and at prototype scale it's plenty fast.
"""
from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import settings

# pool_pre_ping: Neon suspends idle databases, so stale connections are
# detected and replaced instead of failing the first request after a pause.
engine = create_engine(settings.database_url, pool_pre_ping=True, pool_size=5, max_overflow=5)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db() -> Iterator[Session]:
    """FastAPI dependency: one session per request, always closed afterwards."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
