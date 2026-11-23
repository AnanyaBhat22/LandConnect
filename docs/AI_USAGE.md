# AI tools usage summary

The assignment asks for a summary of the AI tools used. This is an honest account of what they did and what I did.

## Tools used

| Tool | Used for |
|---|---|
| **Claude Code** (Anthropic, Claude Opus model, in the Claude desktop app) | Pair programming: planning, writing code, debugging, tests, documentation |
| Web search, through the same assistant | Checking current library versions and docs (Expo SDK 58, LiveKit React Native, MapLibre v11), and researching existing land marketplace apps |

No other AI tools (code autocompletion, image generators, etc.) were used. The app icon and splash were generated from the brand colours by a small Pillow script (`server/scripts/make_brand_assets.py`), not by an image model.

## How I worked with it

1. **Plan first.** Before any code, I asked for a plan, and for the reason behind each step to be written down. That produced [PLAN.md](PLAN.md), [DECISIONS.md](DECISIONS.md) and [DEVLOG.md](DEVLOG.md), which were kept up to date throughout.
2. **My constraints shaped the design.** I chose:
   - a **Python backend**, the language I'm strongest in, which ruled out an all-TypeScript stack;
   - **free services only, with no credit card**, which led to Neon, LiveKit Cloud, Cloudinary, OpenFreeMap and Render;
   - **LandConnect's own branding**, from its LinkedIn page;
   - **one test phone**, which led to the laptop "test peer" script that plays the second user.
3. **Small steps, each tested on a real phone.** Each feature was built, then installed and used on my Android phone. I reported what I saw (screenshots, "the keyboard covers the input", "the screen share is cut off", "the colours look like WhatsApp"), and the AI investigated logs and code to find and fix the cause. The DEVLOG records each of these rounds.
4. **I set the scope.** I added features beyond the brief: photos, videos and documents in chat; meeting rooms with screen share; the acre/sq ft unit switch. I also deferred videos on listings.

## What the AI did

- Proposed the architecture and the stack, and explained the trade-offs (DECISIONS D1–D11), including splitting calls into our own signalling plus LiveKit for media.
- Wrote most of the code: the FastAPI backend, the Socket.IO call state machine, the React Native screens, and the 51 backend tests.
- Debugged problems from logs and from my bug reports. The harder ones:
  - **Calls dropping right after being accepted:** an unstable React callback made LiveKit reconnect.
  - **Photo uploads failing:** Expo's fetch rejects React Native file parts.
  - **The keyboard covering chat inputs:** Android edge-to-edge ignores `adjustResize`.
  - **In-call chat hidden under the video:** WebRTC SurfaceViews draw over normal views.
  - **The test peer stuck reconnecting:** it reused an expired token.
- Wrote the documentation, including this file.

## What I did

- Created and set up all the accounts: GitHub, Expo/EAS, Neon, LiveKit Cloud, Cloudinary, Render. I kept every secret in my local `.env` and the hosting dashboard; none were shared in chat or committed to git.
- Installed and tested every build on my phone, and judged whether each feature actually worked and felt right.
- Made the product calls: roles, privacy features, branding, which extras to add, and when something was good enough.
- Reviewed the changes and the docs, and owned the commits on my GitHub account.

## Where AI helped and where it didn't

- **Helped most:** speed on boilerplate, wide knowledge of library APIs, and systematic debugging from logs. Writing tests alongside the code caught several call-logic bugs before they reached the phone.
- **Needed human checking:** some fixes looked right in code but failed on the device. The keyboard problem took several rounds, and a fix in one screen once broke a related screen. Testing on a real phone was what showed the real problems, and the AI's first diagnosis was sometimes incomplete (DEVLOG Step 20 records one correction). Its library knowledge also had to be checked against current docs, because APIs change between versions.
