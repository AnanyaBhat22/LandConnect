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
_Coming soon: backend and app run instructions._
