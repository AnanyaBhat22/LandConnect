"""LiveKit access tokens.

The LiveKit API secret stays on this server. Clients only ever receive a
signed token that lets ONE identity join ONE room for a limited time, so a
user can't join a call they weren't part of, even if they learn the room name.
"""
from datetime import timedelta

from livekit import api

from app.core.config import settings


def call_room_name(call_id: object) -> str:
    return f"call_{call_id}"


def meeting_room_name(meeting_id: object) -> str:
    return f"meeting_{meeting_id}"


async def close_room(room: str) -> None:
    """Delete a room so nobody can linger in a call after it ended (best effort)."""
    http_url = settings.livekit_url.replace("wss://", "https://").replace("ws://", "http://")
    lk = api.LiveKitAPI(http_url, settings.livekit_api_key, settings.livekit_api_secret)
    try:
        await lk.room.delete_room(api.DeleteRoomRequest(room=room))
    except Exception:  # noqa: BLE001 - room may already be gone; never block hang-up on this
        pass
    finally:
        await lk.aclose()


def create_join_token(*, identity: str, name: str, room: str, ttl: timedelta = timedelta(hours=2)) -> str:
    return (
        api.AccessToken(settings.livekit_api_key, settings.livekit_api_secret)
        .with_identity(identity)  # our user UUID, never a phone number
        .with_name(name)
        .with_ttl(ttl)
        .with_grants(
            api.VideoGrants(room_join=True, room=room, can_publish=True, can_subscribe=True)
        )
        .to_jwt()
    )
