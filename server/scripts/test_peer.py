"""A laptop "second phone" for testing calls when you only have one device.

It logs in as a demo user, connects to the realtime server like the app does,
and reacts to calls. When a call connects it prints a LiveKit Meet link, so
you can join the audio/video from the laptop browser.

Run from server/ (the API must be running):
    # wait for calls from the phone, auto-accept after 3 s
    .venv\\Scripts\\python -m scripts.test_peer --mode accept
    # same, but reject them
    .venv\\Scripts\\python -m scripts.test_peer --mode reject
    # call the phone user named "Asha" (video), wait for them to answer
    .venv\\Scripts\\python -m scripts.test_peer --call Asha --kind VIDEO

Default identity: ravi@example.com / demo1234 (from scripts.seed_demo).
"""
import argparse
import asyncio
import webbrowser
from urllib.parse import urlencode

import httpx
import socketio


def meet_link(livekit_url: str, token: str) -> str:
    return "https://meet.livekit.io/custom?" + urlencode({"liveKitUrl": livekit_url, "token": token})


async def find_user(http: httpx.AsyncClient, name: str) -> dict:
    found = await http.get("/users", params={"q": name})
    found.raise_for_status()
    people = found.json()
    if not people:
        raise SystemExit(f"No user matching '{name}'")
    return people[0]


async def run(args: argparse.Namespace) -> None:
    http = httpx.AsyncClient(base_url=args.api, timeout=15)
    res = await http.post("/auth/login", json={"email": args.email, "password": args.password})
    res.raise_for_status()
    auth = res.json()
    me = auth["user"]
    http.headers["Authorization"] = f"Bearer {auth['access_token']}"
    print(f"Logged in as {me['name']} ({me['role']})")

    callee_id = None
    if args.call:
        person = await find_user(http, args.call)
        callee_id = person["id"]
        print(f"Will call {person['name']}")

    sio = socketio.AsyncClient()
    done = asyncio.Event()

    # ---------- chat: auto-reply so one phone can test messaging ----------
    @sio.on("message:new")
    async def on_message(msg):
        if msg["sender_id"] == me["id"] or msg["type"] != "TEXT" or args.no_reply:
            return
        print(f"\n💬 Message: {msg['body']}")
        conv = msg["conversation_id"]
        await http.post(f"/conversations/{conv}/read")  # turns the phone's ticks blue
        await asyncio.sleep(1)
        await sio.emit("typing", {"conversation_id": conv})  # phone shows "typing…"
        await asyncio.sleep(2.5)
        reply = f"Thanks! You said: “{msg['body'][:80]}”. Happy to arrange a site visit."
        await http.post(f"/conversations/{conv}/messages", json={"body": reply})
        print(f"   ↩ replied")

    @sio.on("call:incoming")
    async def on_incoming(data):
        print(f"\n📞 Incoming {data['kind']} call from {data['caller']['name']} (call {data['call_id'][:8]})")
        if args.mode == "ignore":
            print("   Ignoring it (it'll become a missed call after 30 s)")
            return
        await asyncio.sleep(args.delay)
        event = "call:accept" if args.mode == "accept" else "call:reject"
        print(f"   → {event}: {await sio.call(event, {'call_id': data['call_id']})}")

    @sio.on("call:accepted")
    async def on_accepted(data):
        link = meet_link(data["livekit_url"], data["token"])
        print(f"\n✅ Connected with {data['peer']['name']}. Laptop browser link:\n{link}\n")
        if not args.no_browser:
            # This script only does signalling; the browser tab is the laptop's
            # camera and mic. Without it, the phone is in a call with an empty room.
            print("   Opening it in your browser (allow camera and microphone, then click Join)…")
            webbrowser.open(link)

    @sio.on("call:ended")
    async def on_ended(data):
        print(f"\n⏹  Call ended: {data['status']} ({data['reason']})")
        if args.call:
            done.set()

    # wait_timeout: Neon's free tier sleeps when idle and takes a few seconds to
    # wake; the client's 1 s default would give up before the auth check finishes.
    await sio.connect(args.api, auth={"token": auth["access_token"]}, transports=["websocket"], wait_timeout=15)
    print("Connected to realtime server. Auto-replying to chat messages. Ctrl+C to quit.")

    if args.chat:
        person = await find_user(http, args.chat)
        conv = (await http.post("/conversations", json={"user_id": person["id"]})).json()
        await http.post(f"/conversations/{conv['id']}/messages", json={"body": f"Hi {person['name'].split()[0]}, saw you were looking at land. Any questions?"})
        print(f"Started a chat with {person['name']}")

    if callee_id:
        res = await sio.call("call:invite", {"to": callee_id, "kind": args.kind})
        print(f"Invite: {res}")
        if not res.get("ok"):
            await sio.disconnect()
            return
        await done.wait()
        await sio.disconnect()
    else:
        await sio.wait()


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--api", default="http://localhost:8000")
    p.add_argument("--email", default="ravi@example.com")
    p.add_argument("--password", default="demo1234")
    p.add_argument("--mode", choices=["accept", "reject", "ignore"], default="accept")
    p.add_argument("--delay", type=float, default=3.0, help="seconds to 'ring' before answering")
    p.add_argument("--call", help="name of a user to call instead of waiting")
    p.add_argument("--kind", choices=["AUDIO", "VIDEO"], default="VIDEO")
    p.add_argument("--no-browser", action="store_true", help="print the call link instead of opening it")
    p.add_argument("--chat", help="name of a user to start a chat with (sends a greeting)")
    p.add_argument("--no-reply", action="store_true", help="don't auto-reply to chat messages")
    try:
        asyncio.run(run(p.parse_args()))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
