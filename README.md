# LandConnect

A land marketplace mobile app (Android) for **buyers, sellers and brokers**. Browse land listings on a feed and a map, chat, and make **in-app audio and video calls without sharing phone numbers**.

Built as a technical assignment prototype.

## Try it
- **APK:** _link to be added_ (Android 8+; allow "install unknown apps")
- **Hosted API:** https://landconnect-api-0zf4.onrender.com (`/health` returns `{"status":"ok"}`, `/docs` shows the interactive API)
- **Demo accounts** (password `demo1234`): `asha@example.com` (Buyer), `ravi@example.com` (Seller), `meera@example.com` (Broker)

> The backend is on Render's free tier, which **sleeps after about 15 minutes idle**. The first request after a pause can take 30–60 s. If login seems slow, wait and try again.

## Features
- **Accounts and roles:** register as a Buyer, Seller or Broker. Permissions are enforced by the server (only sellers and brokers can post listings or host meetings).
- **Listings:**
  - create, edit and delete your own listings, and mark them sold;
  - photos from the camera or gallery;
  - price in ₹ lakh/crore, area in acres or sq ft;
  - location with GPS and a map pin.
- **Community and maps:** a listings feed with search and filters, a map view, a mini map on each listing, and saved favourites.
- **Messaging:**
  - one-to-one chat started from a listing or from people search;
  - typing indicators and read ticks;
  - photos, videos and documents.
- **Audio and video calls (the key feature):**
  - start, receive, accept, decline and end calls, with a ring timeout and missed calls;
  - mute, camera, flip, speaker, viewing a screen share, and chat during the call;
  - call history, plus a call message in the chat.
- **Meeting rooms:** sellers and brokers host group video meetings with invites, screen share, and "end for everyone".
- **Privacy:**
  - phone numbers and emails are never shown to other users;
  - optionally hide a listing's exact location;
  - choose who can call you, hide your online status, block users.

## Documentation
| Document | Contents |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Technical architecture: system diagram, call flow, privacy model, data model, deployment |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Why each technology and design choice was made |
| [docs/PLAN.md](docs/PLAN.md) | The original plan and scope |
| [docs/DEVLOG.md](docs/DEVLOG.md) | Step-by-step dev log, with the problems found on the phone and how they were fixed |
| [docs/AI_USAGE.md](docs/AI_USAGE.md) | AI tools usage summary |
| [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md) | Script for the demo video |

## Tech stack
- **App:** React Native (Expo dev build), TypeScript, MapLibre + OpenFreeMap, LiveKit
- **Backend:** Python 3.11, FastAPI, SQLAlchemy + Alembic, python-socketio, PostgreSQL (Neon)
- **Services:** LiveKit Cloud (call media), Cloudinary (images), EAS Build (APK), Render (hosting)


## Repository layout
```
app/      Expo React Native app
server/   FastAPI backend
docs/     architecture, decisions, plan, dev log, AI usage
render.yaml  backend deploy blueprint (Render)
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

### Deploying the backend (Render, free)
1. Render → **New → Blueprint** → choose this repository. It reads [`render.yaml`](render.yaml).
2. Fill in the secret environment variables: `DATABASE_URL`, `LIVEKIT_*`, `CLOUDINARY_*`. `JWT_SECRET` is generated automatically.
3. Deploy. The start command runs the migrations and then the server.
4. Seed the demo data once, by running `scripts.seed_demo` locally with the same `DATABASE_URL`.

The server must run as **one worker**, because live call state is kept in memory (see DECISIONS D9).

### Building the APK (EAS, free)
Set your hosted API URL in `app/eas.json`, under `build.preview.env.EXPO_PUBLIC_API_URL`. EAS builds in the cloud, so it doesn't see local environment variables or `.env`. Then run:
```powershell
cd app
npx eas-cli@latest build --platform android --profile preview
```
EAS prints a download link for the standalone APK when the build finishes.
