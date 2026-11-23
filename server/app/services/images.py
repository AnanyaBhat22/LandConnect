"""Listing photo storage on Cloudinary.

Why Cloudinary: free tier with no card, a CDN, and on-the-fly resizing, and
images survive server restarts (local disk on free hosts is wiped). The app
uploads to OUR server (which checks auth, ownership, type and size) and the
server forwards to Cloudinary, so Cloudinary keys never ship in the app.
"""
from dataclasses import dataclass

import cloudinary
import cloudinary.uploader

from app.core.config import settings

ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"}
MAX_BYTES = 8 * 1024 * 1024  # 8 MB, plenty for a phone photo


@dataclass
class StoredImage:
    url: str
    public_id: str


def _configure() -> None:
    cloudinary.config(
        cloud_name=settings.cloudinary_cloud_name,
        api_key=settings.cloudinary_api_key,
        api_secret=settings.cloudinary_api_secret,
        secure=True,
    )


def upload_listing_image(data: bytes, listing_id: str) -> StoredImage:
    return upload_image(data, f"landconnect/listings/{listing_id}")


def upload_chat_image(data: bytes, conversation_id: str) -> StoredImage:
    return upload_image(data, f"landconnect/chats/{conversation_id}")


def upload_image(data: bytes, folder: str) -> StoredImage:
    _configure()
    result = cloudinary.uploader.upload(
        data,
        folder=folder,
        resource_type="image",
        # Store a sensible max size and let Cloudinary pick format/quality per device.
        transformation=[{"width": 1600, "height": 1600, "crop": "limit"}, {"quality": "auto", "fetch_format": "auto"}],
    )
    return StoredImage(url=result["secure_url"], public_id=result["public_id"])


def delete_image(public_id: str) -> None:
    _configure()
    try:
        cloudinary.uploader.destroy(public_id)
    except Exception:  # noqa: BLE001 - a failed cleanup shouldn't break the user's action
        pass
