"""App settings, loaded from environment variables / server/.env.

Why pydantic-settings: values are type-checked at startup, so a missing or
malformed secret fails immediately instead of mid-request.
"""
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://localhost/landconnect"

    @field_validator("database_url")
    @classmethod
    def use_psycopg_driver(cls, v: str) -> str:
        """Neon gives `postgresql://...`. SQLAlchemy needs the driver named
        (`postgresql+psycopg://`), so we add it here and the string can be pasted as-is."""
        for prefix in ("postgresql://", "postgres://"):
            if v.startswith(prefix):
                return "postgresql+psycopg://" + v[len(prefix):]
        return v
    jwt_secret: str = "change-me"
    access_token_minutes: int = 60
    refresh_token_days: int = 14

    livekit_url: str = ""
    livekit_api_key: str = ""
    livekit_api_secret: str = ""

    cloudinary_cloud_name: str = ""
    cloudinary_api_key: str = ""
    cloudinary_api_secret: str = ""


settings = Settings()
