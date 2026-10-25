#!/usr/bin/env python3
"""One-off Telegram login — only needed if you DON'T import an existing session.
Run interactively:  docker compose run --rm telegrarr python authorize.py
It writes /data/session.session, after which the service runs unattended.
"""
import asyncio

from app import db, tg


def build_client():
    """The service's own client: same session file, API creds, proxy and device
    fingerprint, so this login registers the device the service later presents."""
    db.init()
    return tg.get_client()


async def main():
    client = build_client()
    await client.start()  # prompts for phone + login code (+ 2FA) on first run
    me = await client.get_me()
    print("Authorized as:", me.first_name, f"(id={me.id})")
    await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
