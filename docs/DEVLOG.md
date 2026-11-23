# Development Log

One entry per step: **what** we did, **why**, **problems** we hit and **how** we fixed them. This feeds the "major technical challenges" section of the submission.

---

## 22 Nov 2026

### Step 0: Planning
- **What:** Wrote `docs/PLAN.md` (stack, data model, roles, call flow, schedule) and `docs/DECISIONS.md`.
- **Why:** The deadline is 3.5 days away, and calling is the riskiest requirement, so we planned to build it first and agreed a cut order in advance.
- **Changes during planning:** switched the backend from Node to Python (D2) and maps from Google to MapLibre (D4), so the project needs no credit card.

### Step 1: Repository setup
- **What:** Initialised git; added `.gitignore`, a README skeleton, and `server/.env.example`; scaffolded `app/` (Expo, TypeScript) and `server/` (FastAPI).
- **Why:** A clean structure from the first commit makes the repo easy for reviewers to read, and `.env.example` documents every secret without committing any.

### Step 2: Accounts and connection check
- **What:** Created free accounts (Neon, LiveKit Cloud, Cloudinary, Expo) and added `server/scripts/check_services.py`, which checks each service and prints OK/FAIL without printing secrets. All three passed (Postgres 18 on Neon, LiveKit token minted and API reachable, Cloudinary ping ok).
- **Why:** Proving every key works before writing features means later bugs can't be "wrong key" problems in disguise.
- **Problem / fix:** Neon gives `postgresql://...` but SQLAlchemy needs `postgresql+psycopg://...`. The settings class now rewrites the prefix, so the string can be pasted as-is. Connection pooling is off in Neon, because our server keeps its own connection pool and Alembic migrations want a direct connection.

### Step 3: Calling spike setup
- **What:** Added LiveKit (`@livekit/react-native`, WebRTC, Expo config plugins) and `expo-dev-client`. Configured `app.json` (package `com.landconnect.prototype`, camera/mic permissions) and `eas.json` (a development profile that builds an APK). Wrote a temporary `App.tsx` that joins room `spike` with video, mute, camera toggle and end. `server/scripts/make_spike_tokens.py` mints 24-hour tokens limited to that room: one written into the app, one as a browser link for the laptop.
- **Why:** Calling is the key requirement and depends on native code, so we prove it on a real phone before building features. Only one Android phone is available, so the second participant joins from a laptop browser through LiveKit Meet.
- **Why tokens come from the server:** the LiveKit API secret never ships inside the app. Clients only get signed tokens limited to one room for a short time. The real call flow will work the same way.
- **Checks:** `tsc --noEmit` clean, `expo-doctor` 20/20.
- **Build:** `eas init` linked the app to Expo project `@meadowmaven/landconnect`. The first `eas build --profile development` generated an Android keystore, stored on Expo's servers, and queued a cloud APK build. Secrets (`.env`, `spikeConfig.ts`) are git-ignored, so they're never uploaded. A dev build loads JS from the laptop's Metro server, so the token file only needs to exist locally.

### Step 4: Calling spike result ✅
- **Result:** A two-way video call worked between the Android phone (our dev build) and the laptop (LiveKit Meet in Chrome). Video and audio worked in both directions, along with mute, camera toggle and end. The phone loaded JS from Metro at `http://<laptop-wifi-ip>:8081` over home Wi-Fi.
- **Why it matters:** The riskiest part of the project (native WebRTC inside Expo, LiveKit connectivity, Android camera/mic permissions) is proven on day 0, so the rest of the plan builds on known-good ground.
- **Problem / fix: "App not installed" on a Xiaomi phone.** The 224 MB dev-build APK parsed correctly (name and icon shown) but failed at install with a generic error. Ruled out: a damaged download (the package parsed), CPU type (the build includes armeabi-v7a, arm64-v8a, x86, x86_64), and minimum Android version (API 24 / Android 7). After allowing "Install unknown apps" for File Manager, a later retry succeeded. The exact cause is unconfirmed (likely storage or a Xiaomi install restriction). Lesson for reviewers: the final release APK will be much smaller than a dev build, and the README will include Xiaomi install tips.
- **Problem / fix: Windows has several network adapters** (WSL, Hyper-V, Wi-Fi). Metro was reached through the Wi-Fi adapter's IP, entered manually in the dev client.

### Step 5: Database schema and authentication (day 1 started early)
- **What:**
  - `app/db.py`: engine, sessions and a `get_db` dependency.
  - `app/models.py`: all 10 tables (users, listings, listing_images, favorites, conversations, participants, messages, meeting_rooms, call_logs, blocks).
  - Alembic: the initial migration was generated from the models and applied to Neon.
  - `app/core/security.py`: bcrypt hashing plus JWT access and refresh tokens.
  - `app/core/deps.py`: `get_current_user` and `require_role(...)`.
  - `/auth/register`, `/auth/login`, `/auth/refresh`, `/users/me` (GET/PATCH), `/users/{id}`, block/unblock.
- **Why this order:** every later feature (listings, chat, calls) needs to know *who* is asking and *what role* they have, so auth comes first.
- **Security choices:**
  - The same error for "unknown email" and "wrong password", so the login form doesn't reveal who has an account.
  - Refresh tokens are rejected as access tokens and vice versa (a `type` claim).
  - Passwords are 8–72 characters, because bcrypt ignores anything past 72 bytes.
  - Users can't change their own role through PATCH `/users/me`.
- **Privacy choice:** two response schemas. `UserMe` (your own profile) has email and phone. `UserPublic` (everyone else) has neither, so contact details can't leak through any endpoint.
- **Tests:** 10 pytest tests on in-memory SQLite (about 4 s, offline), covering registration, login, token types, role checks (buyer → 403, seller/broker → 200), the privacy of public profiles, privacy settings and blocking. A smoke test against the real Neon database also passed (register → login → `/users/me`), and its test user was deleted afterwards.
- **Problems / fixes:**
  - The `.env` still had the placeholder `JWT_SECRET=change-me`, which would let anyone forge tokens. Replaced it with a random 64-character secret (never printed or committed).
  - The current Starlette `TestClient` needs the `httpx2` package; added to `requirements-dev.txt`.
  - The email validator rejects reserved domains like `.test`, so the smoke test used `example.com`.

### Step 6: Call signalling (the key requirement, server side)
- **What:**
  - `app/services/calls.py` (`CallManager`): the call rules. Invite, accept, reject, end, a 30 s ring timeout, missed calls for offline users, busy detection, block and privacy checks, and a 20 s grace period for network blips.
  - `app/realtime.py`: a Socket.IO server that authenticates with the same JWT, puts each user's devices in a private `user:<id>` room, and tracks presence.
  - `app/services/livekit.py`: per-call tokens. One room per call, a separate token per participant, 2-hour expiry.
  - `GET /calls`: history for the Calls tab, with direction, status, duration and the other person.
- **Why the rules are separate from sockets:** the call rules are the part being evaluated, so they sit in a plain class that receives actions and returns events through an `emit` callback. That keeps them readable and lets tests drive every scenario in milliseconds without a phone.
- **How each brief requirement maps to the code:**
  - Initiate: `call:invite`
  - Receive: `call:incoming` pushed to every device of the callee
  - Accept or reject: `call:accept` / `call:reject`
  - End: `call:end`
  - No phone numbers: users are addressed by UUID, events carry only `UserPublic` (no email or phone), and LiveKit identities are UUIDs.
- **Privacy and edge cases handled:**
  - A block in either direction returns "unavailable", so the caller can't tell they're blocked.
  - The "calls only from people I've chatted with" setting is enforced.
  - Calling an offline user logs a missed call.
  - A second caller gets BUSY.
  - Only the callee can accept or reject.
  - Ending a call twice gets a clear error, never a crash.
  - If the callee's app disconnects while ringing, the caller sees "missed".
  - During a call, the socket can drop for up to 20 s without ending the call, because the media flows through LiveKit, not the socket.
- **Tests (24 total, all passing):** 12 unit tests for `CallManager` (full flow with JWT claims checked, reject, cancel, timeout, offline, busy, blocked, privacy, self-call, disconnects) and 2 end-to-end tests that start a real uvicorn server and connect two real Socket.IO clients: auth refused without a valid token, plus invite → incoming → accept → both get tokens → end → both get "ended" → history shows it.
- **Known limit:** active calls are kept in memory, so this needs a single server process. That's fine on Render's free tier. Scaling out would move call state to Redis and use Socket.IO's Redis adapter.

### Step 7: App side: login, tabs and the full calling UI
- **What:**
  - Navigation: switched the entry to **Expo Router** (file-based routes in `app/src/app/`). `Stack.Protected` shows the auth screens or the main app depending on login state.
  - Auth: `src/api/client.ts` adds the token to every request, refreshes it once on 401, and signs out if that fails. `src/api/tokenStore.ts` keeps tokens in `expo-secure-store` (Android Keystore). `src/auth/AuthContext.tsx` holds the signed-in user.
  - Screens: login (with one-tap demo accounts), sign-up with a role picker (Buyer/Seller/Broker) and a privacy note, WhatsApp-style tabs (Chats and Community as placeholders, Calls history, Profile with privacy settings and logout), and a "New call" people search.
  - Realtime: `src/realtime/SocketContext.tsx` keeps one authenticated Socket.IO connection. Its `auth` callback sends the latest token on every reconnect, and an "unauthorized" error triggers a refresh and reconnect.
  - Calls: `src/calls/CallContext.tsx` is a state machine (idle → outgoing/incoming → active → ended). `src/calls/CallOverlay.tsx` draws the incoming, ringing, in-call and ended screens **above all navigation**, so a call can ring on any screen. The in-call screen has mute, camera on/off, flip camera, speaker/earpiece, a timer and end. The phone vibrates while ringing and the screen stays awake during calls.
- **Server additions:**
  - `GET /users?q=` searches by name, returns public profiles only, leaves out people who blocked you, and is capped at 20 results.
  - `scripts/seed_demo.py` creates the 3 demo accounts.
  - `scripts/test_peer.py` turns the laptop into a second participant (see below).
- **Why a test peer script:** only one Android phone is available. The script logs in as Ravi, rings or answers like the app would (accept/reject/ignore, or places a call), and prints a LiveKit Meet link so the laptop browser joins the audio/video. That's how every call path gets tested with one device.
- **Why a new dev build:** Expo Router, SecureStore, image picker, location, MapLibre and expo-font are native modules. They were all added now so this is the **last** dev rebuild for the remaining features.
- **Problems / fixes:**
  - `npm` refused `@expo/vector-icons` because of a `react-dom` peer conflict (react-dom 19.3.1 wants react 19.3.0's next patch; react-dom isn't used on mobile). Fixed with `legacy-peer-deps=true` in `app/.npmrc`, which also makes `npm ci` on EAS work.
  - `expo-doctor` flagged `expo-font` as a missing native peer of the icon set. Installed it before building, avoiding a likely crash.
  - Race condition: pressing End while the invite is still in flight. The app now cancels the call as soon as the server returns its ID.
  - TypeScript caught a stale narrowed type on a ref read after an `await`; fixed by re-reading the ref.
- **Checks:** `tsc --noEmit` clean, `expo-doctor` 20/20, server tests 25/25.

## 23 Nov 2026

### Step 8: First real app-to-app video call ✅ (and four fixes found by testing on the phone)
- **Result:** On the phone, Asha (Buyer) searched for Ravi, started a video call and the server rang the laptop peer. Ravi accepted, both sides got LiveKit tokens, the laptop browser joined, two-way video and audio worked, and the hang-up was recorded as COMPLETED in the call history. This is the key requirement working end to end in the real app.
- **Fix 1: "Unmatched Route" on launch.** When signed out, the router opened `/`, which belongs to the protected tabs, and the auth screens sat in a group with no index route, so there was nothing to fall back to. Moved `login`/`register` to the top level (Expo's documented pattern) and added explicit `redirectTo` on both `Stack.Protected` guards.
- **Fix 2: the laptop's Wi-Fi IP changed overnight** (192.168.29.207 → 192.168.0.143), so the app pointed at a dead address. In development, `src/config.ts` now derives the API host from `Constants.expoConfig.hostUri`, the address the phone loaded the app from. An IP change now only means typing the new address once in the dev client. `EXPO_PUBLIC_API_URL` overrides it for release builds.
- **Fix 3: the test peer's socket connect timed out.** Neon's free tier sleeps when idle, so the first auth query takes a few seconds, while python-socketio's client gives up after 1 s. Raised `wait_timeout` to 15 s. (The phone's socket.io-client already waits 20 s.)
- **Fix 4: "accepted" isn't the same as "joined".** The first test felt like nobody answered: the peer script accepted the call (signalling) but nothing joined the LiveKit room (media) until its browser link was opened. The script now opens the link automatically, and the phone shows "Waiting for Ravi to join…" (via `useRemoteParticipants`) until the other side is actually in the room, then starts the timer. If the peer's camera is off, it says so.
- **Lesson:** the separation between signalling (our server) and media (LiveKit) is visible to users, so the UI has to reflect the media state, not just the signalling state.
