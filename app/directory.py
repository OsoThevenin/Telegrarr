# app/directory.py — directory-channel mass import.
#
# A "directory" channel posts links to per-series channels. A scan reads a bounded
# number of its messages, extracts the Telegram channel links (text, hidden text
# links and inline URL buttons), resolves each one WITHOUT joining anything, and
# suggests a TMDB series match. Import creates the ticked ones as mapped series
# channels, skipping channels that are already added.
#
# Account safety: the message read is bounded, resolutions are capped and spaced
# out, the global FloodWait gate is honoured (a closed gate refuses the scan; a
# FloodWait mid-scan trips the gate and stops resolving), and a directory is read
# from Telegram at most once per poll floor (repeat scans reuse that result).
import re
import time
import asyncio
import logging
from dataclasses import dataclass, field

from telethon import utils
from telethon.errors import FloodWaitError

from . import channels, downloader, settings, tg, tmdb, topic_errors
from .config import POLL_FLOOR_MINUTES
from .i18n import KeyedError, message

log = logging.getLogger("directory")

SCAN_MESSAGE_LIMIT = 300          # newest messages read from the directory per scan
MAX_LINKS_PER_SCAN = 60           # channel links resolved per scan; the rest are reported, not resolved
RESOLVE_INTERVAL_S = 1.5          # pause between two username/invite resolutions
RESCAN_AFTER_S = POLL_FLOOR_MINUTES * 60   # a directory is read from Telegram at most this often
MAX_IMPORT_ITEMS = 200

RATE_LIMITED = message("err.directory.rate_limited")
NOT_A_MEMBER = message("err.directory.not_a_member")
NOT_RESOLVED = message("err.directory.not_resolved")
# why a forum topic can't be scanned (topic_errors' classification) -> its error key
TOPIC_ERROR_KEYS = {topic_errors.GONE: "err.directory.topic_gone",
                    topic_errors.INACCESSIBLE: "err.directory.topic_inaccessible"}


class ScanRefused(KeyedError):
    """The scan cannot run now (account-safety limits); carries the reason."""


# ── link extraction ───────────────────────────────────────────────────
_LINK = re.compile(r"(?:https?://)?(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)/([^\s<>\"'()\[\]]+)", re.I)
_USERNAME = re.compile(r"[A-Za-z][A-Za-z0-9_]{3,31}")
_INVITE = re.compile(r"(?:\+|joinchat/)([A-Za-z0-9_-]{12,})")
_PRIVATE = re.compile(r"c/(\d+)")
# t.me paths that are Telegram features, not channels
_RESERVED = {"share", "addstickers", "addemoji", "addtheme", "addlist", "proxy", "socks", "iv", "login",
             "setlanguage", "confirmphone", "boost", "contact", "invoice", "bg", "joinchat", "s", "c"}


@dataclass(frozen=True)
class ChannelLink:
    link: str        # canonical URL, the key the UI and import use
    kind: str        # "public" | "invite" | "private"
    query: str       # what tg.resolve_entity is asked to resolve


def parse_link(path: str) -> ChannelLink | None:
    """A t.me path (after the host) -> the channel it points to, or None."""
    path = path.split("?")[0].split("#")[0].strip("/")
    if m := _INVITE.match(path):
        url = f"https://t.me/+{m.group(1)}"
        return ChannelLink(url, "invite", url)
    if m := _PRIVATE.match(path):
        return ChannelLink(f"https://t.me/c/{m.group(1)}", "private", f"-100{m.group(1)}")
    name = path.split("/")[1] if path.lower().startswith("s/") and "/" in path else path.split("/")[0]
    if not _USERNAME.fullmatch(name) or name.lower() in _RESERVED:
        return None
    return ChannelLink(f"https://t.me/{name}", "public", name)


def _message_urls(msg) -> list[str]:
    urls = [m.group(0) for m in _LINK.finditer(getattr(msg, "message", "") or "")]
    urls += [e.url for e in getattr(msg, "entities", None) or () if getattr(e, "url", None)]
    markup = getattr(msg, "reply_markup", None)
    for row in getattr(markup, "rows", None) or ():
        urls += [b.url for b in getattr(row, "buttons", ()) if getattr(b, "url", None)]
    return urls


def extract_links(messages) -> list[ChannelLink]:
    """Distinct channel links in `messages`, in order of first appearance."""
    found: dict[str, ChannelLink] = {}
    for msg in messages:
        for url in _message_urls(msg):
            m = _LINK.match(url)
            link = parse_link(m.group(1)) if m else None
            if link and link.link.lower() not in found:
                found = {**found, link.link.lower(): link}
    return list(found.values())


# ── TMDB suggestion ───────────────────────────────────────────────────
_NOISE = re.compile(
    r"\b(?:cat|català|catala|catalan|catalán|vose|vo|dual|multi|hd|fhd|uhd|4k|\d{3,4}p|x26[45]|h26[45]|hevc|"
    r"sèries?|series?|temporadas?\s*\d*|t\d{1,2}|s\d{1,2}|completa|oficial|canal|channel)\b", re.I)


def tmdb_query(title: str) -> str:
    """A Telegram channel title stripped of tags, emoji and language/quality noise."""
    t = re.sub(r"[\[\(\{][^\]\)\}]*[\]\)\}]", " ", title or "")
    t = _NOISE.sub(" ", t)
    t = re.sub(r"[^\w\s'’·.&:-]", " ", t)
    t = re.sub(r"\s+", " ", t).strip(" -|·:.")
    return t or (title or "").strip()


# ── scanning ──────────────────────────────────────────────────────────
@dataclass(frozen=True)
class Resolved:
    link: str
    kind: str
    resolved: bool
    chat_id: int | None = None
    title: str = ""
    username: str = ""
    error: dict | None = None        # an i18n message when not resolved


@dataclass(frozen=True)
class TelegramScan:
    directory: dict
    messages_scanned: int
    entries: tuple[Resolved, ...]
    scanned_at: float
    complete: bool = True            # False when a FloodWait cut resolution short


ScanKey = tuple[int, int | None]   # (directory chat id, forum topic id or None for the whole chat)


@dataclass
class _Cache:
    scans: dict[ScanKey, TelegramScan] = field(default_factory=dict)


_cache = _Cache()


def forget_scans() -> None:
    """Drop every remembered scan: the next scan of each directory reads Telegram."""
    _cache.scans = {}


def _gate_check(now: float) -> None:
    if minutes := downloader.flood_gate.minutes_closed(now):
        raise ScanRefused("err.directory.rate_limit_active", minutes=minutes)


async def _resolve(client, link: ChannelLink) -> Resolved:
    try:
        ent = await tg.resolve_entity(client, link.query)
    except tg.NotAMember:
        return Resolved(link.link, link.kind, False, error=NOT_A_MEMBER)
    except FloodWaitError:
        raise
    except Exception as e:
        log.warning("directory: resolving %s failed: %s", link.link, e)
        return Resolved(link.link, link.kind, False,
                        error=message("err.directory.resolve_failed", error=type(e).__name__))
    if not getattr(ent, "title", None):
        return Resolved(link.link, link.kind, False, error=message("err.directory.not_a_channel"))
    return Resolved(link.link, link.kind, True, chat_id=utils.get_peer_id(ent), title=ent.title,
                    username=getattr(ent, "username", None) or "")


async def _resolve_all(client, links: list[ChannelLink], self_id: int) -> tuple[list[Resolved], bool]:
    out: list[Resolved] = []
    for i, link in enumerate(links):
        if i >= MAX_LINKS_PER_SCAN:
            out.append(Resolved(link.link, link.kind, False, error=NOT_RESOLVED))
            continue
        if i:
            await asyncio.sleep(RESOLVE_INTERVAL_S)
        try:
            entry = await _resolve(client, link)
        except FloodWaitError as e:
            await downloader.flood_gate.trip(e.seconds)
            log.warning("directory scan hit FloodWait %ss; %d links left unresolved", e.seconds, len(links) - i)
            return out + [Resolved(rest.link, rest.kind, False, error=RATE_LIMITED) for rest in links[i:]], False
        if entry.chat_id != self_id:
            out.append(entry)
    return out, True


def _read_failed(error: Exception, topic_id: int | None) -> ScanRefused:
    """The refusal for a failed read: why a forum topic is unreadable when that
    is known (deleted, or the group is out of reach), else the generic one."""
    reason = topic_errors.why_unreadable(error) if topic_id is not None else None
    if reason:
        return ScanRefused(TOPIC_ERROR_KEYS[reason])
    return ScanRefused("err.directory.read_failed", error=type(error).__name__)


async def _read_telegram(client, chat_id: int, topic_id: int | None, now: float) -> TelegramScan:
    _gate_check(now)
    try:
        ent = await client.get_entity(chat_id)
        messages = [m async for m in tg.source_messages(
            client, chat_id, limit=SCAN_MESSAGE_LIMIT, topic_id=topic_id)]
    except FloodWaitError as e:
        await downloader.flood_gate.trip(e.seconds)
        raise ScanRefused(RATE_LIMITED["key"]) from e
    except Exception as e:
        log.warning("directory: reading %s (topic %s) failed: %s", chat_id, topic_id, e)
        raise _read_failed(e, topic_id) from e
    entries, complete = await _resolve_all(client, extract_links(messages), chat_id)
    return TelegramScan(directory={"chat_id": chat_id, "title": getattr(ent, "title", "") or ""},
                        messages_scanned=len(messages), entries=tuple(entries), scanned_at=now,
                        complete=complete)


async def _suggestions(entries) -> tuple[dict[str, dict | None], dict | None]:
    """TMDB suggestion per resolved link, plus a TMDB error message (if any)."""
    if not (settings.get("tmdb_key", "") or "").strip():
        return {}, tmdb.KeyMissing().message()
    out: dict[str, dict | None] = {}
    for e in entries:
        if not e.resolved:
            continue
        try:
            hits = await tmdb.search_series(tmdb_query(e.title))
        except tmdb.TMDBError as err:
            return out, err.message()
        out = {**out, e.link: hits[0] if hits else None}
    return out, None


async def scan(client, chat_id: int, now: float | None = None, *,
               topic_id: int | None = None) -> dict:
    """Scan directory `chat_id` (only forum topic `topic_id` when given); each
    (chat, topic) is read from Telegram at most once per RESCAN_AFTER_S."""
    now = time.time() if now is None else now
    key = (chat_id, topic_id)
    cached = _cache.scans.get(key)
    fresh = cached is not None and now - cached.scanned_at < RESCAN_AFTER_S
    result = cached if fresh else await _read_telegram(client, chat_id, topic_id, now)
    if not fresh and result.complete:
        _cache.scans = {**_cache.scans, key: result}
    added = channels.existing_chat_ids()
    suggestions, tmdb_error = await _suggestions(result.entries)
    links = [{**e.__dict__, "already_added": e.chat_id in added, "channel_id": added.get(e.chat_id),
              "suggestion": suggestions.get(e.link)} for e in result.entries]
    return {"directory": result.directory, "topic_id": topic_id,
            "messages_scanned": result.messages_scanned, "links": links, "cached": fresh,
            "scanned_at": result.scanned_at,
            "next_scan_at": result.scanned_at + RESCAN_AFTER_S, "tmdb_error": tmdb_error}


# ── import ────────────────────────────────────────────────────────────
@dataclass(frozen=True)
class ImportItem:
    chat_id: int
    title: str
    tmdb_id: object = None
    tvdb_id: object = None
    series_title: str = ""


async def _import_one(item: ImportItem, added: dict[int, int], poll: int) -> dict:
    base = {"chat_id": item.chat_id, "title": item.title}
    if item.chat_id in added:
        return {**base, "status": "skipped", "detail": message("directory.already_added"), "channel_id": added[item.chat_id]}
    mapped = item.tmdb_id not in (None, "") or item.tvdb_id not in (None, "")
    if mapped:
        try:
            ids = await tmdb.series_ids(item.tmdb_id, item.tvdb_id)
        except tmdb.TMDBError as e:
            return {**base, "status": "failed", "detail": e.message()}
    row = channels.upsert(item.chat_id, item.title or f"Channel {item.chat_id}", kind="tv", poll_minutes=poll)
    if mapped:
        # display title: the picked match, else TMDB's, else the cleaned channel title
        row = await channels.remap(row["id"], ids, item.series_title or ids.title or tmdb_query(item.title))
    return {**base, "status": "added", "channel_id": row["id"], "channel": row}


async def import_channels(items: list[ImportItem]) -> list[dict]:
    """Create the picked channels as series channels; already-added ones are skipped."""
    added = channels.existing_chat_ids()
    poll = channels.default_poll_minutes()
    results = []
    for item in items:
        res = await _import_one(item, added, poll)
        if res["status"] == "added":
            added = {**added, item.chat_id: res["channel_id"]}
        results.append(res)
    return results

