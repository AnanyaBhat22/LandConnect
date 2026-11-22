# LandConnect: Implementation Plan

> Status: **agreed, in progress** (updated 22 Nov: Python backend, no-card maps). Each step says *what* we do and *why*, so this file can later become the Technical Documentation and the interview cheat-sheet.

- **Today:** Sun 22 Nov 2026
- **Deadline:** Wed 25 Nov 2026, 11:59 PM IST. We aim to submit by **6 PM IST on the 25th** and keep the rest as buffer.
- **Time available:** about 3.5 days

---

## 1. Guiding principles

| Principle | Why |
|---|---|
| **Build the riskiest part first (calling)** | Calling is the "KEY REQUIREMENT", and it is the piece most likely to break: native modules, NAT traversal, device permissions. If it fails on day 3, nothing else saves the submission. |
| **Prototype, not production** | The brief says so. We skip the polish that doesn't show up in a demo: admin panel, payments, full test coverage. |
| **Backend in Python (the developer's strongest language)** | The interview asks you to explain your own code, so the server logic (auth, roles, privacy, call signalling) is written where you're most fluent. The app stays TypeScript because React Native requires JS/TS. |
| **No paid services, no credit card** | Every service used has a free tier that signs up without card details. |
| **Use managed services for infrastructure, write the product logic ourselves** | Media servers, TURN and image hosting are commodity work. Auth, roles, privacy, the call-signalling flow and listings are what's being evaluated, so we write those. |
| **Document decisions as we make them** | The interview will ask "why X over Y?". Each decision gets an entry in `docs/DECISIONS.md` at the time we make it, not reconstructed afterwards. |

---

## 2. Proposed tech stack

| Layer | Choice | Why | Alternatives considered |
|---|---|---|---|
| Mobile | **React Native + Expo (SDK latest) + TypeScript**, using an **Expo Dev Build** (not Expo Go) | Expo gives fast iteration, EAS cloud builds an APK without a local Android SDK, and config plugins add the native modules. A dev build is needed because WebRTC is a native module that Expo Go can't load. | Bare React Native CLI: more native setup, and a local build needs JDK 17 (this machine has JDK 22). |
| Navigation / UI | React Navigation (bottom tabs plus stacks), WhatsApp-style theme (green header, Chats / Community / Calls tabs) | This matches the "WhatsApp-inspired" brief directly, and users already know the layout. | Expo Router: also fine. React Navigation is more explicit to explain. |
| Server state | TanStack Query + Axios | Caching, loading and error states, and refetch-on-focus come built in, so there's less hand-written state code. | Redux Toolkit: more boilerplate than a prototype needs. |
| Backend | **Python 3.11 + FastAPI** (run with uvicorn) | It's listed as a preferred option, and Python is the developer's strongest language. Pydantic validates every request, and the auto-generated `/docs` page lets reviewers try the API. | Node/Express: would share types with the app, but means writing the backend in a less familiar language. |
| Database | **PostgreSQL on Neon** (free, no card) + **SQLAlchemy 2.0** + **Alembic** migrations | Postgres is required. SQLAlchemy is the standard Python ORM, and Alembic gives versioned migrations that are easy to show in the repo. | SQLModel: thinner, but less documented. Raw SQL: more boilerplate. |
| Auth | Email + password, **bcrypt** hashing, **PyJWT** access token plus refresh token, FastAPI `Depends()` for `get_current_user` / `require_role(...)`. Tokens kept in **expo-secure-store** on the device | Standard and explainable. SecureStore uses the Android Keystore, so tokens are never kept in plain AsyncStorage. | Firebase Auth: less to explain, and it hides the "secure login" work being evaluated. |
| Realtime | **python-socketio** (ASGI, mounted alongside FastAPI) ↔ `socket.io-client` in the app, carrying chat messages, typing, presence and **call signalling** | It gives one persistent authenticated connection per user. We need it for ringing anyway ("receive incoming call"), so chat uses it too. | FastAPI's raw WebSockets: we'd hand-write reconnection, rooms and acknowledgements. |
| API types in the app | `openapi-typescript` generates TS types from FastAPI's OpenAPI spec | This brings back type safety between app and server without sharing a language. | Writing the types by hand: they drift out of sync. |
| **Audio/video media** | **LiveKit** (LiveKit Cloud free tier) via `@livekit/react-native` + `@livekit/react-native-expo-plugin`; tokens minted by the `livekit-api` Python SDK | Media is the hardest part to get reliable. LiveKit includes TURN servers (calls work across mobile networks and NAT), it handles 1:1 and group calls (so meeting rooms come almost for free), and our backend mints the access tokens, so we keep control of who joins what. | **Raw WebRTC (react-native-webrtc) + our own signalling + a public STUN server**: shows more low-level skill, but it breaks on many mobile networks without a TURN server, and group calls would need a mesh or an SFU. We could run that as a stretch spike. Agora / Stream / 100ms: similar, but more closed. |
| Maps | **`@maplibre/maplibre-react-native`** + **OpenFreeMap** tiles (no key, no account) + `expo-location` (GPS and the phone's built-in reverse geocoder) | It's open source and needs no credit card. Google Maps requires a billing account with a card even when usage is free. We still get markers, a draggable pin for geotagging and a map of all listings. | react-native-maps with Google: simpler setup, but needs a card. OSM's public tile server is a backup, with its required credit line. |
| Images | `expo-image-picker` → upload to backend → **Cloudinary** (free, no card) | Free hosting with resizing and a CDN. Images survive server restarts; local disk on free hosts is wiped. | Supabase Storage: equally fine. |
| Hosting | Backend on **Render** free web service (websockets supported) | A hosted backend means the APK works on any phone with no laptop running, which gives a "hosted application link". Catch: it sleeps after ~15 min idle, so the first request is slow; we'll note this in the README. | If Render asks for a card: **Koyeb** free tier, or the laptop exposed through a free **Cloudflare Tunnel** for the demo. |
| Build | **EAS Build** → APK (`buildType: apk`) | A downloadable APK is the "Working Application Demo". | A local Gradle build: needs an Android SDK and JDK 17 set up. |

---

## 3. Data model (first cut)

```
User        id, name, email (unique), passwordHash, role [BUYER|SELLER|BROKER],
            phone (private, never returned by API), avatarUrl,
            privacy: { showOnlineStatus, allowCallsFrom: EVERYONE|CONTACTS }, createdAt
Listing     id, ownerId → User, title, description, priceINR, areaSqft,
            lat, lng, address, city, hideExactLocation (bool),
            status [ACTIVE|SOLD|DRAFT], createdAt, updatedAt
ListingImage id, listingId, url, order
Conversation id, listingId? (chat started from a listing), createdAt
Participant conversationId, userId, lastReadAt
Message     id, conversationId, senderId, body, type [TEXT|SYSTEM|CALL_LOG], createdAt
MeetingRoom id, conversationId?, hostId, title, scheduledAt?, livekitRoomName
CallLog     id, callerId, calleeId, kind [AUDIO|VIDEO], status [MISSED|REJECTED|COMPLETED],
            startedAt, endedAt
Block       blockerId, blockedId
```

**Why this shape:** a conversation can be tied to a listing, so a buyer's chat starts in context ("about Plot 42"). The phone number lives in the database but is excluded from every API serializer: that is the privacy requirement, enforced in one place. CallLog feeds a "Calls" tab like WhatsApp's.

---

## 4. Roles and permissions

| Action | Buyer | Seller | Broker |
|---|:-:|:-:|:-:|
| Browse community / map | ✅ | ✅ | ✅ |
| Save / favourite listings | ✅ | ✅ | ✅ |
| Create / edit / delete **own** listings | ❌ | ✅ | ✅ |
| Mark listing sold | ❌ | ✅ (own) | ✅ (own) |
| Message / call other users | ✅ | ✅ | ✅ |
| Create meeting rooms | ❌ (join only) | ✅ | ✅ |
| See another user's phone / email | ❌ | ❌ | ❌ |

**How it's enforced:** a FastAPI dependency `require_role(...)` plus ownership checks (`listing.owner_id == current_user.id`). The app hides controls by role, but **the server is the source of truth**. A UI-only check would be a security bug, and the interview will likely ask about it.

---

## 5. How calling works (the key requirement)

```
Caller app            Backend (Socket.IO + REST)                Callee app
   | "call:invite" {to, kind} ──►  check auth, block list,
   |                               callee privacy setting
   |                               create CallLog(RINGING)  ──► "call:incoming" → ringing UI
   |                                                            (ringtone + vibrate)
   |                               ◄── "call:accept" / "call:reject"
   | ◄── "call:accepted" {token}   mint LiveKit token for both  ──► {token}
   |  both join LiveKit room "call_<id>" → audio/video flows peer↔LiveKit↔peer
   | "call:end" ──────────────►    update CallLog(COMPLETED, duration) ──► "call:ended"
   | 30 s no answer → server marks MISSED, notifies both
```

**Why we split it like this:** LiveKit carries the media but has no idea of "ringing". The invite → ring → accept/reject → end flow is product logic, so it lives on our server. The flow covers every bullet in the brief: initiate, receive, accept or reject, end, and no phone numbers (users are addressed by internal user ID only). Tokens are minted per call and expire, so nobody can join a call they weren't invited to.

**Call screen features:** mute, camera on/off, switch camera, speaker toggle, timer, end. If the callee is offline, the call goes to "missed" and a CALL_LOG message is posted in the chat.

**Known limit (we state it honestly in the docs):** incoming calls ring while the app is open or in the recent background (socket connected). Ringing when the app is fully killed needs FCM data messages plus native call UI (CallKeep / ConnectionService). That is a stretch goal; we can add a push notification ("X is calling you") with `expo-notifications` if time allows.

**Meeting rooms:** a seller or broker creates a room (optionally linked to a listing chat). Participants get a join button, and the backend mints a token for a multi-party LiveKit room with a grid view. It reuses the same call screen components.

---

## 6. Day-by-day schedule

### Day 0: Sun 22 Nov (rest of today), foundations + calling spike
1. **Init the monorepo** (`/app`, `/server`, `/docs`), git, a README skeleton, and `docs/DECISIONS.md`.
   *Why:* a single repo is what we submit, and setting up the structure early keeps commits clean for reviewers.
2. **Create accounts and keys** (all free, no card): Expo, LiveKit Cloud, Neon, Cloudinary, GitHub.
   *Why:* account sign-ups and key provisioning are the usual surprise blockers, so we clear them now.
3. **Calling spike:** a bare Expo dev build with LiveKit, two hard-coded tokens, two devices joining one room with video.
   *Why:* this proves the riskiest native piece works on real hardware before we build anything around it. If it fails, we switch approach (raw WebRTC or a different SDK) on day 0, not on day 3.

### Day 1: Mon 23 Nov, backend core + real calling
4. **Server skeleton:** FastAPI, SQLAlchemy models, Alembic migrations, error handling, settings from `.env`, health route.
5. **Auth:** register/login/refresh, bcrypt, JWT, `get_current_user`, `require_role`, a sanitised `UserPublic` Pydantic schema (no phone or email leaks).
   *Why first:* every other feature needs an authenticated user and a role.
6. **App shell:** auth screens with role picker, a SecureStore token flow, WhatsApp-style tabs.
7. **Socket.IO auth + call signalling** (the flow in §5), a LiveKit token endpoint, incoming-call overlay, call screen, call logs tab.
   *Why on day 1:* the key requirement gets the most testing time.

### Day 2: Tue 24 Nov, marketplace features
8. **Listings API:** CRUD with ownership/role checks, image upload (Cloudinary), filters (price, city, text search), pagination.
9. **Community screen:** a feed of listing cards with image carousel, price, location and owner badge (role), plus a detail screen with "Chat" / "Call" buttons.
10. **Create/Edit listing:** form, image picker (several images), a **map with a draggable pin** plus "use my location".
11. **Map tab:** every listing as a marker; tapping one opens a preview. An approximate circle is shown when `hideExactLocation` is set.
12. **Messaging:** a conversation list, a chat screen (realtime, read state, timestamps), "start chat from listing".
13. **Meeting rooms:** create, list, and join a multi-party LiveKit room.

### Day 3: Wed 25 Nov, privacy, polish, delivery
14. **Privacy:** block user, "allow calls from", hide online status, approximate location. An audit confirms no endpoint returns phone or email.
15. **Seed data:** about 15 realistic listings and 3 demo accounts (one per role), so reviewers can log in instantly.
16. **Deploy the backend** to Render and point the app at it. **EAS build the APK** and test it on two devices.
17. **Docs:** README (setup and run), `ARCHITECTURE.md` (diagram), `DECISIONS.md`, `AI_USAGE.md`, known limitations.
18. **Demo video** (3–5 min): register → browse → create listing with map pin → chat → **audio call (accept), video call (reject, then accept), end** → meeting room.
19. **Submit** by about 6 PM IST: reply to the email with the repo, APK link, video and docs.

**Cut order if we fall behind** (drop from the top first): meeting-room scheduling → favourites → filters → push notifications for calls → block user. We **never** cut calling, auth/roles, listings with a map, or chat.

---

## 7. Repository layout

```
LandConnect/
├─ app/                 Expo React Native (TypeScript)
│  ├─ src/screens/      Auth, Community, ListingDetail, ListingForm, Map, Chats, Chat, Calls, CallScreen, Meetings
│  ├─ src/components/   ListingCard, IncomingCallModal, MapPicker, ...
│  ├─ src/services/     api.ts (axios), socket.ts, calls.ts (signalling client)
│  └─ src/store/        auth context, call state
├─ server/              FastAPI + SQLAlchemy (Python)
│  ├─ alembic/          migrations
│  └─ app/  main.py  core/ (config, security, deps)  models/  schemas/
│           routers/ (auth, listings, chats, calls, meetings)  sockets/  services/ (livekit, cloudinary)
└─ docs/  PLAN.md  DECISIONS.md  ARCHITECTURE.md  AI_USAGE.md  DEVLOG.md
```

`docs/DEVLOG.md` gets a short entry for every step: **what we did, why, what went wrong, how we fixed it.** That covers the "documenting why each step was done" request, and it feeds the "major technical challenges" section of the submission.

---

## 8. Things I need from you before building

1. **Devices:** do you have an Android phone? A calling demo needs **two endpoints**. Options: two phones, or one phone plus an Android emulator (an emulator camera works, but it's slower).
2. **Stack:** ✅ agreed: Expo (TypeScript) + FastAPI (Python) + Postgres + LiveKit + MapLibre.
3. **Accounts:** you sign up yourself for Expo, LiveKit Cloud, Neon, Cloudinary and GitHub (all free, no card). I can't create accounts or enter credentials for you. You paste the keys into a local `.env`, and I wire everything up. If any sign-up page asks for card details, stop and tell me.
4. **GitHub:** which account or repo name should we push to, and should it be public?
