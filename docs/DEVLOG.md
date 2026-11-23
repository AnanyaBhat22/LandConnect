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

### Step 9: Incoming calls tested on the phone: accept ✅ decline ✅ (two more fixes)
- **Result:** The laptop peer (Ravi) called the phone (Asha). The full-screen incoming screen appeared with vibration. **Accept** connected the LiveKit room in about 1.1 s with two-way video. **Decline** ended the call as `REJECTED` on both sides. Every calling requirement in the brief (initiate, receive, accept, reject, end, no phone numbers) is now verified on a real device.
- **Fix 5: the call dropped about 0.1 s after accepting** ("The remote description was null" ×4 in the dev error overlay, which also covered the screen). Root cause, confirmed in `@livekit/components-react` source: `LiveKitRoom`'s connect effect lists `onError` in its dependency array. We passed an inline arrow function, so the first re-render after mounting changed its identity, re-ran the effect, and aborted the half-finished WebRTC negotiation ("Abort connection attempt due to user initiated disconnect"). Fix: a stable `onError` via `useCallback` + a ref. Also, only a `ConnectionError` ends the call now; camera/mic publish problems are logged instead of hanging up on the other person.
- **Fix 6: a brief socket drop during ringing killed the call.** One test ended as `MISSED (disconnected)` (the app had actually been closed, which is correct behaviour), but it showed that *any* momentary drop, which is common with Android battery saving and Wi-Fi handovers, ended a ringing call immediately and lost the incoming-call alert. Now:
  - a disconnect during ringing starts the same grace timer as during a call (the ring timeout still applies on top);
  - when the callee reconnects, the server **re-sends `call:incoming`**, so the Accept/Decline screen reappears;
  - the app ignores a re-sent alert for the call already on screen (the old code would have auto-declined it as "busy");
  - finishing a call cancels any pending grace timers.
- **Tests:** 26 passing. New test: callee drops while ringing, reconnects, gets the alert again, and the call stays alive past the grace period and can still be declined.
- **Debugging approach worth noting:** in each case we read three logs side by side (backend HTTP/socket log, test-peer log, Metro device log with LiveKit/WebRTC debug lines) and only changed code once a log line explained the failure.

### Step 10: Feedback from testing: screen share, in-call chat, own colours
- **Screen share wasn't visible to the viewer.** The call screen only rendered *camera* tracks, so when the laptop shared its screen, only the sharer saw it. It now subscribes to camera **and** screen-share tracks. A remote screen share takes the main view (`objectFit: contain`, so documents and site plans aren't cropped) with a "sharing their screen" label, and it shows even during voice calls.
- **In-call chat.** Messages typed in the browser's chat didn't reach the phone because the phone had no chat. Added `src/calls/InCallChat.tsx` using LiveKit's standard chat protocol (`useChat` over the room's data channel), so it interoperates with any LiveKit client in the room. It has a chat button with an unread badge, a slide-up panel with bubbles, and messages that exist only for the call (persistent conversations belong in the Chats tab).
- **Own colour palette.** The first version copied WhatsApp's greens. The brief asks for a WhatsApp-*inspired* interface, so we kept the familiar layout (coloured header, tabs, call screens) but gave LandConnect an earthy brand: deep pine `#1F3B2F`, field green `#3E7C5A`, terracotta `#D9824B` and warm sand. All colours come from `src/theme.ts` tokens (`primary`, `secondary`, `accent`, `success`, `danger`), so the change touched one file plus a few direct usages. Accept and Decline stay green and red because those meanings are universal.
- **Small fix:** `StyleSheet.absoluteFillObject` no longer exists in this React Native version (TypeScript caught it); replaced with explicit positioning.

### Step 11: Land listings, maps and geotagging
- **Server (`app/routers/listings.py`):**
  - Browse with search (title/description/city), city and price filters, and pagination. The public feed shows only ACTIVE listings; "mine" shows all of a user's own.
  - Create/edit/delete via `require_role(SELLER, BROKER)` plus an ownership check: another seller gets 403 on your listing.
  - Photos upload to **our** server, which checks ownership, type (JPEG/PNG/WebP/HEIC), size (≤ 8 MB) and count (≤ 8), then forwards to Cloudinary (resized to ≤ 1600 px, auto format/quality). Cloudinary keys never ship in the app. Deleting a listing or photo also deletes it from Cloudinary.
  - Favourites work for any role, and repeat saves are harmless (idempotent).
  - **Location privacy:** with "Hide exact location", non-owners get coordinates rounded to 2 decimals (~1 km) and **no street address**. The exact point never leaves the server for them, so the app can't leak it. The owner always sees the exact spot.
- **App:**
  - **Community tab:** a feed of listing cards (photo, ₹ in lakh/crore, ₹/sq ft, area in sq ft or acres, city, owner role badge, save heart) with debounced search, and a **list/map toggle**. The map shows price pins (dashed when approximate) and a preview card when tapped.
  - **Listing detail:** a swipeable photo gallery, key facts, a mini map (exact pin, or a ~1 km circle when approximate), description and owner card, with **Call / Video** buttons that start an in-app call to the owner. This links the marketplace to the key calling requirement, still without exposing phone numbers. Owners get Edit / Mark sold / Delete instead.
  - **Create/edit form:** photos from the gallery or camera (up to 8, removable), details, a **location picker** where the pin stays centred and you move the map under it (easier with a finger than dragging a marker), a "use my location" GPS button, the phone's own reverse geocoder to pre-fill city/address, and a hide-exact-location toggle. The listing is saved first, then photos upload one by one, so a single failed photo doesn't lose the listing.
  - **Profile:** "My listings" (sellers/brokers) and "Saved land" links.
  - Maps use MapLibre + OpenFreeMap (no key, no card) with the OpenStreetMap attribution shown.
- **Seed data:** 8 demo listings across Maharashtra (Lonavala, Pune, Nashik, Mahabaleshwar, Chakan, Karjat, Alibaug), 3 with hidden exact location. They start without photos, so the upload flow can be shown in the demo.
- **No rebuild needed:** the location and image-picker native modules (and their Android permissions) were already in the last dev build.
- **Checks:** 34 server tests (8 new: roles, ownership, filters, hidden location, photo rules, photo limit, favourites). `tsc` clean. A full `expo export` confirmed every screen compiles. In development Expo Router loads screens lazily, so the plain dev bundle doesn't include them.

### Step 12: Listings feedback fixes and LandConnect branding
- **Area in acres:** the form only accepted sq ft, so a value typed in acres was stored as sq ft. Added an **Acres / Sq ft** switch (defaulting to acres, as land is usually described). Switching units converts the number already typed, and the API keeps storing sq ft.
- **Buttons under Android's navigation bar:** Android 15 / Expo SDK 58 draw apps edge-to-edge, so bottom bars sat under Back/Home/Recents. Full-screen pages (listing detail contact bar and owner actions, the create/edit form, My listings) now add `useSafeAreaInsets().bottom`. Tab screens were already fine because the tab bar handles the inset.
- **Photo didn't upload (under investigation):** the backend log showed `POST /listings 201` but **no** request to `/images`, and a laptop-side upload through the same API to Cloudinary succeeded, so the failure is client-side, before the request leaves the phone. The upload helper used to swallow the underlying error, so failures now show "Reason: …" in the alert and are logged to the dev server with the file URI and type.
- **Branding from LandConnect's own logo (D11):** palette taken from the company's banner (dark forest `#12251E` for headers, emerald `#167A5B` for buttons and prices, mint `#5FD1A2`, pale mint, and the amber dot `#F2A12E` for floating buttons and badges). Comfortaa (a free Google Font close to their rounded geometric wordmark) is used for headings and the wordmark. A `LogoMark` drawn with plain Views (emerald tile, white and pale-mint shapes, amber dot) and a two-tone "Land**Connect**" wordmark appear in the main header. The login screen gets a banner-style hero with their tagline **"Privacy. Confidentiality."**, which also fits the app's privacy features. Fonts load through `expo-font`, which is already in the dev build, so no rebuild was needed.

### Step 13: Photo upload fixed (root cause) and photos shown uncropped
- **Root cause of the failed upload:** with the error now visible, the phone showed *"Unsupported FormDataPart implementation"*. Searching `node_modules` traced it to `expo/src/winter/fetch/convertFormData.ts`: in Expo SDK 52+ the global `fetch` is Expo's WinterCG implementation, which doesn't accept React Native-style file parts (`{uri, name, type}`) and throws before sending, which is why the backend never saw a request. **Fix:** `uploadFile` now uses React Native's `XMLHttpRequest`, which goes through the native networking module that reads the file from its URI. Normal JSON calls stay on `fetch`. Verified on the phone: the photo uploaded to Cloudinary and appears on the listing.
- **Lesson:** "silent" error handling hid this for a whole test round. Showing the real reason in the UI and logging it turned a guessing game into a one-step fix.
- **Photo dimensions:** phone photos are usually portrait, but the gallery was a short landscape strip using `cover`, so most of the photo was cropped away. The new `PhotoGallery` uses a 4:3 area showing the **whole photo** (`contain`) over a blurred, zoomed copy of itself, so there are no empty bars. **Tapping opens a full-screen, swipeable viewer** with a photo counter. Feed cards keep a uniform cropped thumbnail, which suits a list.

### Step 14: In-app messaging (Chats tab)
- **Design:** one conversation per pair of users (like WhatsApp). A chat started from a listing remembers it and posts a SYSTEM note "About: <title>", and the chat header shows a tappable listing card. Sending is a REST call (validated, stored, retryable). The server then pushes `message:new` over the existing Socket.IO connection to every device of both users, so delivery is instant with no polling.
- **Server (`routers/chats.py`, `services/chat.py`):** list conversations (peer, last message, unread count, listing, online status), start/reuse a conversation, paginated messages, send, mark read (pushes `conversation:read` so the sender's ticks turn blue), a total unread count for the tab badge, and a `typing` socket event relayed only to conversation members. **Finished calls are written into the chat as CALL_LOG messages** with a JSON body, so each side renders them from its own perspective ("Missed video call" for the callee, "No answer" for the caller). Pushes from sync endpoints use `anyio.from_thread.run`, and a failed push never fails the request.
- **Privacy:** peers appear only as `UserPublic` (no phone/email). Online status shows only if the peer allows it (`show_online_status`). Blocking (either way) stops starting chats and sending. Non-members get 404 for a conversation.
- **App:** a Chats list (avatar, online dot, preview, time, unread badge, role, listing chip) that reorders live, and an unread badge on the Chats tab. The chat screen has bubbles, day separators, optimistic sending (clock → ✓✓, blue when read, "tap to retry" on failure), a "typing…" indicator in the header (throttled to one event per 3 s), call-history pills, a listing card, and voice/video call buttons in the header. The Chat button on listings and the people search now open chats.
- **Test peer:** `scripts/test_peer.py` now auto-replies to chat messages (marks them read, shows typing, then replies), and `--chat <name>` starts a chat, so messaging can be tested end to end with one phone.
- **Tests:** 41 passing (7 new): one conversation per pair, send/list/push, outsiders blocked, blocking, unread and read receipts, listing note without duplicates, and a missed call recorded in the chat.
- **Planned next:** listing videos (user suggestion). Needs `expo-video` (a native module), so it will ship with the final release build, uploaded directly to Cloudinary with a server-signed upload to keep large files off the API server.

### Step 15: Chat and call fixes from phone testing; pictures in chat; brand icon and splash
- **Keyboard covered the chat input.** It was the same edge-to-edge cause as the nav-bar overlap: on Android 15 / SDK 58 the keyboard overlays the window instead of resizing it, so `KeyboardAvoidingView` (`height` mode) does nothing. Added `useKeyboardHeight()` (keyboard show/hide events) and padded by the keyboard's height in the chat input, the in-call chat panel and the listing form. This is JS only, with no extra native library.
- **"Typing…" was easy to miss.** Verified the server relays `typing` correctly with two test sockets, so the issue was visibility: it only showed in the header for about 2 s. Now an animated **typing bubble** also appears at the bottom of the conversation (as in WhatsApp), and the test peer "types" for about 5 s.
- **Bubble sides:** a message on the left that looked like the user's own was in fact sent by the Ravi account. A database query confirmed sender IDs, so no bug.
- **Screen share cut at top/bottom:** the name/timer bar and the controls bar were drawn over the video. Tapping the video now **hides/shows the controls** (WhatsApp behaviour, with a "Tap to show controls" hint), and a shared screen is laid out *between* the bars while they're visible.
- **Browser stayed on "Disconnected":** that's LiveKit's demo page, our laptop stand-in, not part of the app. Still, the server now **deletes the LiveKit room when an answered call ends** (`livekit.close_room`, injected into `CallManager` so tests never call LiveKit). Nobody can linger in, or rejoin, a finished call's room.
- **Pictures in chat (user suggestion):** a 📎 button lets you take or pick a photo, which appears instantly from the local file, uploads via XHR to `POST /conversations/{id}/images` (same type/size checks as listing photos, Cloudinary folder per chat), and is pushed as an `IMAGE` message. Tap to view full screen, and failed uploads can be retried. Adding the `IMAGE` type needed **no migration**, because the column is a VARCHAR (non-native enum, no CHECK constraint, confirmed on Neon).
- **White grid "page" on launch:** that was Expo's **default splash image**. `scripts/make_brand_assets.py` (Pillow) now draws the LandConnect mark (emerald tile, white and pale-mint shapes, amber dot) and generates the app icon, Android adaptive icon (foreground/background/monochrome), splash image and favicon. The splash is configured on the dark brand colour via `expo-splash-screen`. It takes effect in the next native build.
- **Tests:** 43 passing (new: picture messages incl. type and membership checks; the LiveKit room is closed only for answered calls).

### Step 16: Reliable keyboard handling, videos and documents in chat
- **The keyboard still covered inputs.** The JS workaround (padding by `keyboardDidShow` height) wasn't reliable under Android edge-to-edge. Switched to **`react-native-keyboard-controller`** (Expo's recommended library for this; native, with Reanimated as a peer dependency): `KeyboardProvider` at the root, its `KeyboardAvoidingView` in the chat and in-call chat, and `KeyboardAwareScrollView` in the listing form, login and sign-up, which scrolls the focused field into view. The in-call chat input also clears the Back/Home bar when the keyboard is closed, and keeps the keyboard open after sending.
- **Typing dots "looked stuck":** replaced the step-and-fade dots with a native-driven `Animated` wave (staggered bounce).
- **In-call chat hid the shared screen:** with the chat panel open, the video now moves into the space above it.
- **Videos and documents in chat (user suggestion):** the 📎 menu has Camera, Photo or video, and Document (`expo-document-picker`).
  - `POST /conversations/{id}/attachments` accepts videos (MP4/MOV/WebM, ≤ 40 MB, uploaded to Cloudinary as video, with an auto-generated poster frame via the `so_1` transformation) and documents (PDF, Word, Excel, PowerPoint, text/CSV, ≤ 10 MB, stored as raw with the original filename).
  - Messages are `VIDEO`/`FILE` with a JSON body `{url, name, size, mime[, thumb]}`.
  - In the app, videos show a thumbnail with a play button and open a full-screen `expo-video` player. Documents show a card (type colour, name, size) that opens in the phone's viewer.
  - Size limits are checked on the phone before uploading and again on the server.
- **Cloudinary blocks PDF delivery on free accounts by default.** A real upload test: `.txt` downloaded with 200, `.pdf` with **401**. Fix: enable *Settings → Security → "Allow delivery of PDF and ZIP files"* in the Cloudinary console. It's an account setting, done by the account owner.
- **New native build** (keyboard controller, Reanimated, expo-video, document picker, brand splash and icon) started in parallel while the JS was written.
- **Tests:** 45 passing (new: video + document messages with type checks and pushes; size limit → 413). Deprecated Starlette 413/422 constants were replaced.

### Step 17: Keyboard root cause, attachment sheet
- **Videos and documents in chat confirmed working on the phone** (PDF card opens, video plays) after enabling *Allow delivery of PDF and ZIP files* in Cloudinary. A re-test went from 401 to 200.
- **"Crash" on launch after the new build:** not the app. The Metro dev server had been started *before* Reanimated was installed and kept a stale module map ("Unable to resolve ./useAnimatedProps"). The phone couldn't download its JS bundle, which looked like a crash. Restarting Metro with `--clear` fixed it.
- **Keyboard still covered the chat input, even with react-native-keyboard-controller.** Two independent approaches (RN `Keyboard` events and the library's `KeyboardAvoidingView`) both failing pointed one level down: Android wasn't in *adjustResize* soft-input mode, so the window neither resized nor reported keyboard insets to the app. Fix: `KeyboardController.setInputMode(SOFT_INPUT_ADJUST_RESIZE)` at startup (no rebuild needed), `KeyboardProvider` told the app is edge-to-edge (`statusBarTranslucent`, `navigationBarTranslucent`, `preserveEdgeToEdge`), and `android.softwareKeyboardLayoutMode: "resize"` in `app.json` for future builds.
- **Attachment menu:** the stock Android alert spaced its three buttons awkwardly. Replaced with a WhatsApp-style bottom sheet (`src/chat/AttachSheet.tsx`): round colour-coded icons for Document, Photo or video, and Camera, plus the size limits shown as a hint.
