#!/usr/bin/env python3
"""One-off Telegram login — only needed if you DON'T import an existing session.
Run interactively:  docker compose run --rm telegrarr python authorize.py
It writes /data/session.session, after which the service runs unattended.
"""
import asyncio
from app.config import API_ID, API_HASH, SESSION_PATH
from telethon import TelegramClient


async def main():
    client = TelegramClient(SESSION_PATH, API_ID, API_HASH)
    await client.start()  # prompts for phone + login code (+ 2FA) on first run
    me = await client.get_me()
    print("Authorized as:", me.first_name, f"(id={me.id})")
    await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
