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

### Demo accounts
Run `.\.venv\Scripts\python -m scripts.seed_demo` once. All demo accounts use the password **demo1234**:
`asha@example.com` (Buyer), `ravi@example.com` (Seller), `meera@example.com` (Broker).

### App (Expo dev build)
```powershell
cd app
npm install
Copy-Item .env.example .env      # set EXPO_PUBLIC_API_URL to your laptop's Wi-Fi IP
npx expo start --dev-client
```
Install the development build APK on the phone, then connect it to the dev server shown by Expo.

### Testing calls with one phone
The laptop can act as the second person:
```powershell
cd server
.\.venv\Scripts\python -m scripts.test_peer --mode accept    # answers calls from the phone
.\.venv\Scripts\python -m scripts.test_peer --call Asha        # calls the phone user
```
When a call connects, it prints a LiveKit Meet link. Open it in the laptop browser to see and hear the phone.
