# Demo video script (about 4–5 minutes)

**Setup before recording**
- The phone runs the final APK, logged in as **Asha (Buyer)**.
- The laptop runs the test peer as **Ravi (Seller)**, auto-accepting calls, with its browser tab as Ravi's camera.
- Record the phone screen with Android's built-in screen recorder. A screen recording can't show the phone and laptop together, so for the call scenes either film the laptop screen with a second camera, or record the laptop browser separately and place it side by side when editing. Both are fine; the phone recording matters most.
- Open the hosted API's `/health` page a minute before you start, so the free server is awake.

| # | Time | Show | Say (roughly) |
|---|---|---|---|
| 1 | 0:00–0:20 | Splash screen, then the login screen | "This is LandConnect, a land marketplace for buyers, sellers and brokers. The key feature is in-app audio and video calling, so people never share phone numbers." |
| 2 | 0:20–0:45 | Register screen with the three roles, then log in as Asha | "Every account has a role. Buyers browse and contact people; sellers and brokers can also post listings and host meetings. The server enforces these permissions." |
| 3 | 0:45–1:25 | Community tab: scroll the feed, switch to the map, open a listing (photo gallery, price in lakh, area, mini map, owner card with no phone number) | "Listings have photos, a description, price and location. This seller hid their exact location, so I only see the approximate area." |
| 4 | 1:25–1:55 | Log in as Ravi on the phone (or show it pre-recorded): new listing, take a photo, pick a location with GPS and the map pin, save | "Sellers create listings with photos from the camera or gallery, and set the location with GPS or by moving the map." |
| 5 | 1:55–2:25 | Back as Asha: tap **Chat** on the listing, send a message, see "typing…" and the reply, send a photo or document | "Chat opens straight from the listing. It shows typing indicators and read ticks, and supports photos, videos and documents." |
| 6 | 2:25–3:25 | **Video call:** tap the video icon, it rings, Ravi accepts, show both sides of the video, then mute, camera off/on, flip camera, speaker, in-call chat, end call. Show the call message in the chat and in Calls history. | "This is the core of the app: a video call with no phone numbers. The server handles ringing, accepting and ending, and LiveKit carries the media. Every call is logged in the chat and the call history." |
| 7 | 3:25–3:55 | **Incoming call + reject:** restart the peer with `--call Asha`, the phone rings full screen, tap Decline; then an audio call that is accepted | "Incoming calls ring full screen anywhere in the app, and can be accepted or declined. Declined and missed calls are logged too." |
| 8 | 3:55–4:20 | **Meeting room:** as a seller or broker, create a meeting, invite Asha; show the invite pop-up, the group grid and a screen share; End for everyone | "Sellers and brokers can host meeting rooms for group site discussions, with screen sharing. The host can end the meeting for everyone." |
| 9 | 4:20–4:45 | Profile: privacy toggles (hide online status, calls only from people I've chatted with), block a user | "Privacy controls decide who can call you, whether your online status shows, and who is blocked. Contact details are never exposed." |
| 10 | 4:45–5:00 | The GitHub README or architecture diagram | "The backend is Python FastAPI with Socket.IO signalling, the app is React Native. The setup, architecture and decisions are documented in the repo. Thank you." |

**Tips**
- Keep the calling scenes (6 and 7) as the longest part; that's the main requirement.
- If something fails while recording, just record that scene again and cut it in. Don't restart the whole video.
- Before recording scene 7, run the test peer for a reject:

  ```powershell
  .\.venv\Scripts\python -m scripts.test_peer --api <hosted-url> --call Asha --kind VIDEO
  ```

  Decline on the phone, then run it again and accept.
