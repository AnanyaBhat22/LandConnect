# LandConnect

A land marketplace mobile app for buyers, sellers and brokers, with a WhatsApp-inspired interface: browse land listings on a feed and a map, chat, and make in-app audio and video calls without sharing phone numbers.

> Work in progress: technical assignment prototype.

## Tech stack
- **App:** React Native (Expo dev build), TypeScript, MapLibre + OpenFreeMap, LiveKit
- **Backend:** Python 3.11, FastAPI, SQLAlchemy + Alembic, python-socketio, PostgreSQL (Neon)
- **Services:** LiveKit Cloud (call media), Cloudinary (images), EAS Build (APK), Render (hosting)

The reasons behind each choice are in [docs/DECISIONS.md](docs/DECISIONS.md), and the full plan is in [docs/PLAN.md](docs/PLAN.md).

## Repository layout
```
app/      Expo React Native app
server/   FastAPI backend
docs/     plan, decisions, dev log, architecture
```

## Setup

### Backend (Python 3.11+)
```powershell
cd server
python -m venv .venv
.\.venv\Scripts\pip install -r requirements-dev.txt
Copy-Item .env.example .env      # then fill in your own keys
.\.venv\Scripts\python -m scripts.check_services   # verifies Neon, LiveKit, Cloudinary
.\.venv\Scripts\alembic upgrade head               # creates the database tables
.\.venv\Scripts\uvicorn app.main:asgi --reload --host 0.0.0.0 --port 8000
```
Interactive API docs: http://localhost:8000/docs. Realtime (chat and call signalling) runs over Socket.IO on the same port.

Run the tests: `.\.venv\Scripts\python -m pytest -q`

### App
_Coming soon._
