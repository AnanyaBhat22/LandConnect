# Decision Log

Each entry records a technical decision when it was made: the context, what we chose, why, and what we gave up. Newest at the bottom.

---

## D1: React Native with Expo (Dev Build), TypeScript
- **Date:** 22 Nov 2026
- **Context:** The brief prefers React Native. Calling needs native WebRTC modules, which Expo Go can't load.
- **Decision:** Expo SDK with `expo-dev-client` (a custom dev build), app code in TypeScript, APKs built by EAS Build in the cloud.
- **Why:** Expo gives fast reload during development, config plugins add native modules without editing Android code by hand, and EAS builds the APK without a local Android SDK. This machine has JDK 22, while Android builds need JDK 17. TypeScript catches mistakes in API payloads early.
- **Trade-off:** Every new native module needs a fresh dev build (about 10–20 minutes on EAS).

## D2: Backend in Python (FastAPI) instead of Node.js
- **Date:** 22 Nov 2026
- **Context:** The brief allows Python (FastAPI) or Node.js. Python is the developer's strongest language, and the interview requires explaining the code.
- **Decision:** FastAPI + SQLAlchemy 2.0 + Alembic + python-socketio + PyJWT/bcrypt.
- **Why:** The core logic being evaluated (auth, roles, privacy, call signalling) is written in the language we can explain best. FastAPI validates requests with Pydantic and auto-generates OpenAPI docs at `/docs`.
- **Trade-off:** App and server no longer share types. Mitigation: generate TS types from FastAPI's OpenAPI spec with `openapi-typescript`.

## D3: LiveKit for call media, our own server for call signalling
- **Date:** 22 Nov 2026
- **Context:** Audio/video calling is the key requirement. Raw peer-to-peer WebRTC often fails on mobile networks without a TURN relay server, and group calls need a media server.
- **Decision:** LiveKit Cloud (free tier) carries the audio and video. Ringing, accept, reject, end and missed calls run over our own Socket.IO server. The backend mints a short-lived LiveKit token per call.
- **Why:** This is reliable media without running servers ourselves, and the product logic (who may call whom, the ringing flow, call logs, privacy) stays in our own code. The same setup handles multi-party meeting rooms.
- **Trade-off:** It depends on a third-party service. Raw WebRTC stays possible as a stretch spike.

## D4: MapLibre + OpenFreeMap instead of Google Maps
- **Date:** 22 Nov 2026
- **Context:** Google Maps needs a billing account with a credit card, even when usage is free. The project must have no card and no cost.
- **Decision:** `@maplibre/maplibre-react-native` with OpenFreeMap tiles (no key, no account). `expo-location` handles GPS and reverse geocoding through the phone's built-in geocoder.
- **Why:** It's free and open source, needs no card, and still covers markers, a draggable location picker and a map of all listings.
- **Trade-off:** It's slightly more setup than react-native-maps, and we must show the OpenStreetMap credit line on the map.

## D5: Free, no-card services only
- **Date:** 22 Nov 2026
- **Decision:** Neon (Postgres), Cloudinary (images), LiveKit Cloud (media), Expo/EAS (builds), Render (backend hosting), GitHub (code).
- **Why:** There's no cost and no card details. Fallbacks if Render asks for a card: Koyeb's free tier, or a Cloudflare Tunnel from the laptop.
- **Trade-off:** A free Render server sleeps after about 15 minutes idle, so the first request takes 30–60 seconds. This is documented in the README.
