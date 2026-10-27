# app/tg.py — single shared Telethon client + account helpers.
import re
import time
import asyncio
import logging
from urllib.parse import urlparse
from telethon import TelegramClient, types, utils
from telethon.errors import ChannelForumMissingError, SessionPasswordNeededError
from telethon.tl.functions.messages import CheckChatInviteRequest, GetForumTopicsRequest
from . import settings
from .i18n import message
from .config import (API_ID, API_HASH, SESSION_PATH, PROXY, TG_DEVICE_MODEL, TG_SYSTEM_VERSION,
                     TG_APP_VERSION, TG_LANG_CODE, TG_SYSTEM_LANG_CODE)

log = logging.getLogger("tg")
_client: TelegramClient | None = None
_dialogs_cache = {"ts": 0, "data": []}
_login = {}   # transient state during the interactive sign-in flow
GENERAL_TOPIC_ID = 1   # Telegram's fixed id for a forum group's General topic


def _api_creds():
    # user-provided creds (via the setup wizard) take precedence over .env defaults
    return (settings.get_int("tg_api_id", 0) or API_ID,
            settings.get("tg_api_hash", "") or API_HASH)


def _proxy_url() -> str:
    # DB setting (from the UI) wins over the TELEARR_PROXY env default.
    return (settings.get("tg_proxy", "") or PROXY or "").strip()


def proxy_display() -> str:
    """Human-readable proxy summary with any credentials stripped (for the UI)."""
    url = _proxy_url()
    if not url:
        return ""
    try:
        u = urlparse(url)
        return f"{u.scheme}://{u.hostname}:{u.port}" if u.hostname else url
    except Exception:
        return "(set)"


def _build_proxy_kwargs() -> dict:
    """Translate the proxy URL into TelegramClient kwargs. Supports SOCKS5/4 and
    HTTP (via python-socks) and Telegram's own MTProxy. Returns {} when unset or
    unparseable, so a bad value degrades to a direct connection rather than
    breaking the client."""
    url = _proxy_url()
    if not url:
        return {}
    try:
        u = urlparse(url)
        scheme = (u.scheme or "").lower()
        host, port = u.hostname, u.port
        if not host or not port:
            log.warning("proxy URL missing host/port: %s", proxy_display())
            return {}
        if scheme in ("socks5", "socks4", "http"):
            conf = {"proxy_type": scheme, "addr": host, "port": port, "rdns": True}
            if u.username:
                conf["username"] = u.username
            if u.password:
                conf["password"] = u.password
            return {"proxy": conf}
        if scheme in ("mtproxy", "mtproto"):
            # mtproxy://<secret>@host:port — secret carried in the userinfo slot
            secret = u.username or (u.password or "")
            from telethon import connection as _conn
            return {"proxy": (host, port, secret),
                    "connection": _conn.ConnectionTcpMTProxyRandomizedIntermediate}
        log.warning("unsupported proxy scheme %r — ignoring", scheme)
    except Exception as e:
        log.warning("bad proxy URL: %s", e)
    return {}


def _fingerprint() -> dict:
    """Desktop-like device identity sent on connect (account safety)."""
    return {"device_model": TG_DEVICE_MODEL, "system_version": TG_SYSTEM_VERSION,
            "app_version": TG_APP_VERSION, "lang_code": TG_LANG_CODE,
            "system_lang_code": TG_SYSTEM_LANG_CODE}


def get_client() -> TelegramClient:
    """The one shared client, always on the single persistent session file."""
    global _client
    if _client is None:
        aid, ahash = _api_creds()
        _client = TelegramClient(
            SESSION_PATH, aid, ahash,
            **_fingerprint(),
            connection_retries=5,
            retry_delay=2,
            auto_reconnect=True,
            flood_sleep_threshold=60,
            **_build_proxy_kwargs(),
        )
    return _client


async def set_proxy(url):
    """Persist a proxy URL, rebuild the client through it, and test-connect."""
    settings.set("tg_proxy", (url or "").strip())
    await reset_client()
    if not (url or "").strip():
        return {"ok": True, "proxy": ""}
    try:
        c = get_client()
        await asyncio.wait_for(c.connect(), timeout=20)
        authed = await c.is_user_authorized()
        return {"ok": True, "proxy": proxy_display(), "authorized": authed}
    except Exception as e:
        return {"error": message("err.tg.proxy", error=str(e))}


async def reset_client():
    """Disconnect and drop the client so the next get_client() rebuilds it.
    Disconnecting first avoids two live clients on one session (AUTH_KEY_DUPLICATED)."""
    global _client
    if _client is not None:
        try:
            if _client.is_connected():
                await _client.disconnect()
        except Exception:
            pass
    _client = None


# ── interactive sign-in (web wizard) ──────────────────────────────────
def _failed(e: Exception) -> dict:
    """A Telegram error for the UI: translated frame, Telegram's own text as the param."""
    return {"error": message("err.tg.failed", error=str(e))}


async def auth_status():
    aid, ahash = _api_creds()
    api_ready = bool(aid and ahash)
    authed = False
    if api_ready:
        try:
            c = get_client()
            if not c.is_connected():
                await c.connect()
            authed = await c.is_user_authorized()
        except Exception:
            authed = False
    return {"authorized": authed, "api_ready": api_ready}


async def set_api(api_id, api_hash):
    try:
        settings.set("tg_api_id", str(int(str(api_id).strip())))
    except (TypeError, ValueError):
        return {"error": message("err.tg.api_id_number")}
    settings.set("tg_api_hash", str(api_hash).strip())
    await reset_client()
    return {"ok": True}


async def send_code(phone):
    if not phone:
        return {"error": message("err.tg.phone_required")}
    try:
        c = get_client()
        if not c.is_connected():
            await c.connect()
        res = await c.send_code_request(phone.strip())
        _login.update(phone=phone.strip(), hash=res.phone_code_hash)
        return {"ok": True}
    except Exception as e:
        return _failed(e)


async def sign_in_code(code):
    if not _login.get("phone"):
        return {"error": message("err.tg.code_first")}
    try:
        c = get_client()
        await c.sign_in(phone=_login["phone"], code=str(code).strip(), phone_code_hash=_login["hash"])
        _login.clear()
        return {"ok": True}
    except SessionPasswordNeededError:
        return {"need_password": True}
    except Exception as e:
        return _failed(e)


async def sign_in_password(password):
    try:
        c = get_client()
        await c.sign_in(password=password)
        _login.clear()
        return {"ok": True}
    except Exception as e:
        return _failed(e)


async def logout():
    try:
        c = get_client()
        if not c.is_connected():
            await c.connect()
        await c.log_out()
        await reset_client()
        return {"ok": True}
    except Exception as e:
        return _failed(e)


async def authorized_client():
    """The shared client, connected; None when the account is not signed in."""
    c = get_client()
    if not c.is_connected():
        await c.connect()
    return c if await c.is_user_authorized() else None


_ready = authorized_client


def source_messages(c, chat_id: int, *, limit: int | None = None, topic_id: int | None = None):
    """A source's messages on client `c`, newest first: the one place scans,
    backfills and directory scans read a chat's history.

    `topic_id` restricts the read to one forum topic (Telethon's `reply_to`
    filter); None reads the whole chat, as for a channel. Telegram refuses that
    filter for the General topic, so General reads the whole group and keeps
    the messages of no named topic (`limit` then counts messages read, not kept)."""
    if topic_id is None:
        return c.iter_messages(chat_id, limit=limit)
    if topic_id == GENERAL_TOPIC_ID:
        return _general_messages(c.iter_messages(chat_id, limit=limit))
    return c.iter_messages(chat_id, limit=limit, reply_to=topic_id)


def _in_named_topic(msg) -> bool:
    """Whether `msg` belongs to a named forum topic. Telegram flags every message
    of a named topic, posts and replies alike, with `reply_to.forum_topic`; a
    General message has no reply header, or (a reply) one without that flag."""
    return bool(msg.reply_to is not None and getattr(msg.reply_to, "forum_topic", False))


async def _general_messages(messages):
    """The General topic's posts among a forum group's `messages` (service
    messages such as topic creations are left out)."""
    async for msg in messages:
        if not _in_named_topic(msg) and not getattr(msg, "action", None):
            yield msg


FORUM_TOPICS_LIMIT = 100   # topics asked for in one forum-topics request


async def list_topics(c, chat_id: int) -> list[dict] | None:
    """A forum group's topics on client `c` as `{topic_id, title}`, in the order
    Telegram gives them (General, id GENERAL_TOPIC_ID, included: it is a source
    like any other topic); None when the chat isn't a forum group.

    One forum-topics request at most (none for a non-forum chat). Telegram errors
    (FloodWaitError included) propagate to the caller."""
    ent = await c.get_entity(chat_id)
    if not getattr(ent, "forum", False):
        return None
    try:
        res = await c(GetForumTopicsRequest(peer=ent, offset_date=None, offset_id=0,
                                            offset_topic=0, limit=FORUM_TOPICS_LIMIT))
    except ChannelForumMissingError:
        return None
    return [{"topic_id": t.id, "title": t.title} for t in res.topics
            if isinstance(t, types.ForumTopic)]


async def list_dialogs(limit=250):
    """Channels/groups the logged-in account belongs to — so users pick, not paste ids."""
    now = time.time()
    if now - _dialogs_cache["ts"] < 30 and _dialogs_cache["data"]:
        return _dialogs_cache["data"]
    c = await _ready()
    if not c:
        return []
    out = []
    try:
        async for d in c.iter_dialogs(limit=limit):
            if d.is_user:
                continue
            e = d.entity
            out.append({
                "chat_id": d.id,
                "title": d.title or getattr(e, "title", "") or "",
                "username": getattr(e, "username", None) or "",
                "kind": "channel" if getattr(e, "broadcast", False) else "group",
                "members": getattr(e, "participants_count", None),
            })
    except Exception as e:
        log.warning("list_dialogs failed: %s", e)
    out.sort(key=lambda x: x["title"].lower())
    _dialogs_cache.update(ts=now, data=out)
    return out


def _invite_hash(q):
    m = re.search(r"(?:t\.me/\+|t\.me/joinchat/|joinchat/|(?:^|/)\+)([A-Za-z0-9_-]{12,})", q)
    return m.group(1) if m else None


class NotAMember(Exception):
    """An invite link to a chat the account has not joined (we never join for it)."""


async def resolve_entity(c, query: str):
    """Resolve a @username / t.me link / invite link / id to an entity on client `c`.

    Account safety: never joins anything. Invite links only resolve for chats the
    account is already a member of; others raise NotAMember. Telegram errors
    (FloodWaitError included) propagate to the caller."""
    ih = _invite_hash(query)
    if ih:
        chk = await c(CheckChatInviteRequest(ih))
        ent = getattr(chk, "chat", None)
        if ent is None:
            raise NotAMember(getattr(chk, "title", "") or "")
        return ent
    u = re.sub(r"^https?://t\.me/", "", query).lstrip("@").strip("/")
    if re.fullmatch(r"-?\d+", u):
        cid = int(u)
        return await c.get_entity(cid if cid < 0 else int(f"-100{u}"))
    return await c.get_entity(u)


async def resolve(query):
    """Resolve a @username / t.me link / invite link / id → chat (never joins)."""
    c = await _ready()
    if not c:
        return {"error": message("err.tg.not_connected")}
    q = (query or "").strip()
    if not q:
        return {"error": message("err.tg.empty_query")}
    try:
        ent = await resolve_entity(c, q)
    except NotAMember:
        return {"error": message("err.tg.not_a_member")}
    except Exception as e:
        return _failed(e)
    if ent is None:
        return {"error": message("err.tg.unresolved")}
    _dialogs_cache["ts"] = 0   # invalidate so the new channel shows in the picker
    return {"chat_id": utils.get_peer_id(ent), "title": getattr(ent, "title", "") or "",
            "username": getattr(ent, "username", None) or ""}
