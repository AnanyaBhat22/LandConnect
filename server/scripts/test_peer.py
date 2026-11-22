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
from urllib.parse import urlencode

import httpx
import socketio


def meet_link(livekit_url: str, token: str) -> str:
    return "https://meet.livekit.io/custom?" + urlencode({"liveKitUrl": livekit_url, "token": token})


async def run(args: argparse.Namespace) -> None:
    async with httpx.AsyncClient(base_url=args.api, timeout=15) as http:
        res = await http.post("/auth/login", json={"email": args.email, "password": args.password})
        res.raise_for_status()
        auth = res.json()
        me = auth["user"]
        print(f"Logged in as {me['name']} ({me['role']})")

        callee_id = None
        if args.call:
            found = await http.get(
                "/users", params={"q": args.call}, headers={"Authorization": f"Bearer {auth['access_token']}"}
            )
            found.raise_for_status()
            people = found.json()
            if not people:
                raise SystemExit(f"No user matching '{args.call}'")
            callee_id = people[0]["id"]
            print(f"Will call {people[0]['name']}")

    sio = socketio.AsyncClient()
    done = asyncio.Event()

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
        print(f"\n✅ Connected with {data['peer']['name']}. Join from the laptop browser:\n{meet_link(data['livekit_url'], data['token'])}\n")

    @sio.on("call:ended")
    async def on_ended(data):
        print(f"\n⏹  Call ended: {data['status']} ({data['reason']})")
        if args.call:
            done.set()

    await sio.connect(args.api, auth={"token": auth["access_token"]}, transports=["websocket"])
    print("Connected to realtime server. Ctrl+C to quit.")

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
    try:
        asyncio.run(run(p.parse_args()))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
