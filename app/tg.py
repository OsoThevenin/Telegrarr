# app/tg.py — single shared Telethon client + account helpers.
import re
import time
import asyncio
import logging
from urllib.parse import urlparse
from telethon import TelegramClient, utils
from telethon.errors import SessionPasswordNeededError
from telethon.tl.functions.messages import CheckChatInviteRequest
from . import settings
from .config import (API_ID, API_HASH, SESSION_PATH, PROXY, TG_DEVICE_MODEL, TG_SYSTEM_VERSION,
                     TG_APP_VERSION, TG_LANG_CODE, TG_SYSTEM_LANG_CODE)

log = logging.getLogger("tg")
_client: TelegramClient | None = None
_dialogs_cache = {"ts": 0, "data": []}
_login = {}   # transient state during the interactive sign-in flow


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
        return {"error": f"Could not connect through proxy: {e}"}


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
        return {"error": "API ID must be a number"}
    settings.set("tg_api_hash", str(api_hash).strip())
    await reset_client()
    return {"ok": True}


async def send_code(phone):
    if not phone:
        return {"error": "Enter your phone number (with country code)"}
    try:
        c = get_client()
        if not c.is_connected():
            await c.connect()
        res = await c.send_code_request(phone.strip())
        _login.update(phone=phone.strip(), hash=res.phone_code_hash)
        return {"ok": True}
    except Exception as e:
        return {"error": str(e)}


async def sign_in_code(code):
    if not _login.get("phone"):
        return {"error": "Request a code first"}
    try:
        c = get_client()
        await c.sign_in(phone=_login["phone"], code=str(code).strip(), phone_code_hash=_login["hash"])
        _login.clear()
        return {"ok": True}
    except SessionPasswordNeededError:
        return {"need_password": True}
    except Exception as e:
        return {"error": str(e)}


async def sign_in_password(password):
    try:
        c = get_client()
        await c.sign_in(password=password)
        _login.clear()
        return {"ok": True}
    except Exception as e:
        return {"error": str(e)}


async def logout():
    try:
        c = get_client()
        if not c.is_connected():
            await c.connect()
        await c.log_out()
        await reset_client()
        return {"ok": True}
    except Exception as e:
        return {"error": str(e)}


async def _ready():
    c = get_client()
    if not c.is_connected():
        await c.connect()
    return c if await c.is_user_authorized() else None


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


async def resolve(query):
    """Resolve a @username / t.me link / invite link / id → chat.

    Account safety: never joins anything automatically. Invite links only resolve
    for chats the account is already a member of."""
    c = await _ready()
    if not c:
        return {"error": "Telegram not connected"}
    q = (query or "").strip()
    if not q:
        return {"error": "empty"}
    ent = None
    try:
        ih = _invite_hash(q)
        if ih:
            chk = await c(CheckChatInviteRequest(ih))
            ent = getattr(chk, "chat", None)
            if ent is None:
                return {"error": "Join this chat in your Telegram app first, then add it here"}
        else:
            u = re.sub(r"^https?://t\.me/", "", q).lstrip("@").strip("/")
            if re.fullmatch(r"-?\d+", u):
                cid = int(u)
                ent = await c.get_entity(cid if cid < 0 else int(f"-100{u}"))
            else:
                ent = await c.get_entity(u)
    except Exception as e:
        return {"error": str(e)}
    if ent is None:
        return {"error": "could not resolve"}
    _dialogs_cache["ts"] = 0   # invalidate so the new channel shows in the picker
    return {"chat_id": utils.get_peer_id(ent), "title": getattr(ent, "title", "") or "",
            "username": getattr(ent, "username", None) or ""}
