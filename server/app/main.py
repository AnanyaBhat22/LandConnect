"""LandConnect API entry point.

Run locally (from server/):  uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
`--host 0.0.0.0` lets a phone on the same Wi-Fi reach the laptop.
Interactive API docs: http://localhost:8000/docs
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import auth, users

app = FastAPI(
    title="LandConnect API",
    version="0.1.0",
    description="Land marketplace backend: auth & roles, listings, chat and call signalling.",
)

# The mobile app isn't a browser, so CORS only matters for the /docs page and
# any web testing. It's open for the prototype and would be restricted in production.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(users.router)


@app.get("/health", tags=["meta"])
def health() -> dict[str, str]:
    """Used by Render's health check and to confirm the phone can reach the server."""
    return {"status": "ok"}
