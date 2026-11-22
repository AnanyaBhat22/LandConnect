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
