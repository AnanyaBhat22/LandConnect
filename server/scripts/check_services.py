"""Check that every external service in server/.env is reachable.

Run from server/:  .venv\\Scripts\\python -m scripts.check_services

Prints only OK / FAIL plus the error type, never the secrets themselves.
Why this exists: when something breaks later, this tells us in seconds whether
it's our code or a key/config problem.
"""
import asyncio

from app.core.config import settings


def check_database() -> str:
    from sqlalchemy import create_engine, text

    engine = create_engine(settings.database_url, pool_pre_ping=True)
    with engine.connect() as conn:
        version = conn.execute(text("select version()")).scalar_one()
    return version.split(",")[0]


async def check_livekit() -> str:
    from livekit import api

    # 1) Minting a token proves the key/secret pair is well-formed locally.
    token = (
        api.AccessToken(settings.livekit_api_key, settings.livekit_api_secret)
        .with_identity("healthcheck")
        .with_grants(api.VideoGrants(room_join=True, room="healthcheck"))
        .to_jwt()
    )
    # 2) Listing rooms proves LiveKit Cloud accepts those credentials.
    http_url = settings.livekit_url.replace("wss://", "https://").replace("ws://", "http://")
    lk = api.LiveKitAPI(http_url, settings.livekit_api_key, settings.livekit_api_secret)
    try:
        rooms = await lk.room.list_rooms(api.ListRoomsRequest())
    finally:
        await lk.aclose()
    return f"token minted ({len(token)} chars), {len(rooms.rooms)} active rooms"


def check_cloudinary() -> str:
    import cloudinary
    import cloudinary.api

    cloudinary.config(
        cloud_name=settings.cloudinary_cloud_name,
        api_key=settings.cloudinary_api_key,
        api_secret=settings.cloudinary_api_secret,
        secure=True,
    )
    return f"ping {cloudinary.api.ping().get('status')}"


def run(name: str, fn) -> bool:
    try:
        result = asyncio.run(fn()) if asyncio.iscoroutinefunction(fn) else fn()
        print(f"[OK]   {name}: {result}")
        return True
    except Exception as exc:  # noqa: BLE001 - we want every failure reported
        print(f"[FAIL] {name}: {type(exc).__name__}: {str(exc)[:200]}")
        return False


if __name__ == "__main__":
    results = [
        run("Neon Postgres", check_database),
        run("LiveKit Cloud", check_livekit),
        run("Cloudinary", check_cloudinary),
    ]
    raise SystemExit(0 if all(results) else 1)
