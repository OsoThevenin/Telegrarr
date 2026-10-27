# app/routes/topics.py — a forum group's topics, for the add-channel topic picker.
#
# Account safety: the FloodWait gate is checked before every Telegram request
# of the listing (a closed gate refuses it without asking Telegram), and a
# FloodWait while listing trips the shared gate.
import logging

from fastapi import Depends, HTTPException
from telethon.errors import FloodWaitError

from .. import auth, downloader, tg
from .common import BAD_GATEWAY, CONFLICT, TOO_MANY, LooseId, bad, keyed_router, normalize_chat_id

log = logging.getLogger("topics")
router = keyed_router()


def _gate_check() -> None:
    if minutes := downloader.flood_gate.minutes_closed():
        raise bad(TOO_MANY, "err.topics.rate_limit_active", minutes=minutes)


@router.get("/api/telegram/topics")
async def api_telegram_topics(chat_id: LooseId = None, user=Depends(auth.require_user)):
    """`{forum: true, topics: [{topic_id, title}]}` for a forum group;
    `{forum: false, topics: []}` for a channel or plain group."""
    cid = normalize_chat_id(chat_id)
    client = await tg.authorized_client()
    if not client:
        raise bad(CONFLICT, "err.tg.not_connected")
    try:
        topics = await tg.list_topics(client, cid, before_request=_gate_check)
    except HTTPException:
        raise
    except FloodWaitError as e:
        await downloader.flood_gate.trip(e.seconds)
        raise bad(TOO_MANY, "err.topics.rate_limited") from e
    except Exception as e:
        log.warning("listing topics of %s failed: %s", cid, e)
        raise bad(BAD_GATEWAY, "err.topics.read_failed", error=type(e).__name__) from e
    return {"forum": topics is not None, "topics": topics or []}
