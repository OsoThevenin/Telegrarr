# app/scanner.py — channel scanner: reads channels and indexes their releases.
#
# NOTE: the poll schedule and the background task are process-wide state, correct
# ONLY under a single event loop / single uvicorn worker (see app/transfers.py).
import time
import asyncio

from . import channels, db, settings, safety, resolver, movies, topic_errors
from .arr import category_for
from .i18n import message
from .series_titles import cached_series_name, display_title, is_tv, series_name
from .tg import get_client, source_messages
from .namer import (group_key, message_episode, extract_episode_title,
                    build_save_path, flat_save_path, is_uhd, release_name, quality_from_dims,
                    DEFAULT_LANGUAGE, extract_movie)
from .config import TV_DIR, TV_DIR_4K, MOVIES_DIR, MOVIES_DIR_4K, OTHER_DIR
# MAX_DOWNLOAD_RETRIES, _retry_failed and _spawn keep their scanner names for callers.
from .transfers import (MAX_DOWNLOAD_RETRIES, enqueue, queue_grab,  # noqa: F401
                        resume_pending_downloads, retry_failed as _retry_failed,
                        spawn as _spawn)

_active = None
_poll = safety.PollScheduler()          # 15-min floor + per-scan random jitter
DEFAULT_SEASON = 1                      # season of an episode-only series release
LOOP_PAUSE_S = 30                       # how often the scan loop looks for due channels


def base_dir_for(channel, quality=None):
    k = (channel["kind"] or "tv").lower()
    uhd = is_uhd(quality)
    if k == "tv":
        return TV_DIR_4K if uhd else TV_DIR
    if k == "movie":
        return MOVIES_DIR_4K if uhd else MOVIES_DIR
    return OTHER_DIR


def _file_name(doc, msg_id):
    for attr in getattr(doc, "attributes", []) or []:
        if getattr(attr, "file_name", None):
            return attr.file_name
    return f"file_{msg_id}.mp4"


def _video_dims(doc) -> tuple[int | None, int | None]:
    """Width/height from Telegram's DocumentAttributeVideo, if the upload has one."""
    for attr in getattr(doc, "attributes", []) or []:
        w, h = getattr(attr, "w", None), getattr(attr, "h", None)
        if isinstance(w, int) and isinstance(h, int):
            return w, h
    return None, None


def _parse_episode(channel, msg, fn) -> dict:
    """Episode info of a message (see ``message_episode`` for file name vs caption).

    Series channels also take a bare number in the file name, and an episode
    without a season goes to season 1 (season 0 is Sonarr's specials)."""
    info = message_episode(msg.message, fn, bare=is_tv(channel))
    if is_tv(channel) and info["episode"] and not info["season"]:
        return {**info, "season": DEFAULT_SEASON}
    return info


def _is_mapped(channel) -> bool:
    return bool((channel["imdb_id"] or "").strip() or (channel["imdb_title"] or "").strip())


def _message_quality(channel, msg, parsed_quality):
    """Quality precedence: video dimensions > quality tag in the text > the
    channel's fallback quality."""
    width, height = _video_dims(msg.document or msg.video)
    return quality_from_dims(width, height, fallback=parsed_quality or channel["fallback_quality"])


def build_release(channel, msg, fn, *, episode: int | None = None,
                  series_name: str | None = None) -> dict:
    """What a Telegram media message is published as on the Newznab feed.

    ``episode`` overrides the parsed episode number (a resolved two-part episode).
    ``series_name`` starts the title (see `series_titles.series_name`); by default
    it is taken from the cache, without asking Sonarr."""
    info = _parse_episode(channel, msg, fn)
    if episode is not None:
        info = {**info, "episode": episode}
    season, episode = info.get("season") or 0, info.get("episode") or 0
    quality = _message_quality(channel, msg, info.get("quality"))
    show = display_title(channel)
    title = release_name(series_name or cached_series_name(channel), season, episode,
                         quality or "", channel["kind"],
                         language=channel["language"] or DEFAULT_LANGUAGE,
                         episode_end=info.get("episode_end"))
    episode_title = extract_episode_title(msg.message or "", fn, season, episode,
                                          show_title=show, mapped=_is_mapped(channel),
                                          bare=is_tv(channel))
    return {"title": title, "season": info.get("season"), "episode": info.get("episode"),
            "episode_end": info.get("episode_end"), "quality": quality, "episode_title": episode_title}


def _resolve_path(channel, msg, fn):
    info = _parse_episode(channel, msg, fn)
    show = display_title(channel)
    ep_title = extract_episode_title(msg.message or "", fn,
                                     info.get("season") or 0,
                                     info.get("episode") or 0, show_title=show,
                                     mapped=_is_mapped(channel), bare=is_tv(channel))
    base = base_dir_for(channel, info.get("quality"))
    return build_save_path(base, show, info.get("season") or 0,
                           info.get("episode") or 0, fn, ep_title)


def _already_have(channel, gk, size) -> bool:
    """True if this episode (group_key) is already grabbed for this SHOW.

    When a channel is mapped to a title (imdb_id/imdb_title), dedup spans every
    channel sharing that mapping — so adding a second source channel for the same
    show never re-downloads episodes another source already has. Unmapped
    channels fall back to per-channel dedup."""
    imdb_id = (channel["imdb_id"] or "").strip()
    imdb_title = (channel["imdb_title"] or "").strip()
    conds, args = [], []
    if imdb_id:
        conds.append("ch.imdb_id=?")
        args.append(imdb_id)
    if imdb_title:
        conds.append("ch.imdb_title=?")
        args.append(imdb_title)
    with db.conn() as c:
        if conds:
            args.append(gk)
            row = c.execute(
                f"""SELECT d.status, d.file_size FROM downloads d
                    JOIN channels ch ON ch.id = d.channel_id
                    WHERE ({' OR '.join(conds)}) AND d.group_key=?
                    ORDER BY d.file_size DESC LIMIT 1""", args).fetchone()
        else:
            row = c.execute(
                """SELECT status, file_size FROM downloads
                   WHERE channel_id=? AND group_key=? ORDER BY file_size DESC LIMIT 1""",
                (channel["id"], gk)).fetchone()
    return bool(row and row["status"] in ("completed", "downloading", "queued")
                and row["file_size"] >= size)


async def _iter_best(client, chat_id, *, limit, stop_at=0, topic_id=None):
    """Yield newest→older media, keeping only the largest file per group_key."""
    best = {}
    max_seen = stop_at
    async for msg in source_messages(client, chat_id, limit=limit, topic_id=topic_id):
        if stop_at and msg.id <= stop_at:
            break
        max_seen = max(max_seen, msg.id)
        doc = msg.document or msg.video
        if not doc:
            continue
        fn = _file_name(doc, msg.id)
        gk = group_key(msg.message or "", fn, msg.id)
        cur = best.get(gk)
        if cur is None or doc.size > cur[1]:
            best[gk] = (msg, doc.size, fn)
    return best, max_seen


def _flat_path(channel, msg, fn):
    """*arr grab path: <downloads>/telegram/<category>/<release title>/<file>.

    Uses the indexed release title (what Sonarr/Radarr grabbed) when present."""
    with db.conn() as c:
        row = c.execute("SELECT title FROM releases WHERE channel_id=? AND message_id=?",
                        (channel["id"], msg.id)).fetchone()
    title = row["title"] if row else build_release(channel, msg, fn)["title"]
    return flat_save_path(settings.arr_root(), category_for(channel["kind"]), title, fn)


def _is_mapped_series(channel) -> bool:
    return (channel["kind"] or "tv") == "tv" and bool(channel["tmdb_id"] or channel["tvdb_id"])


def _log_resolution(channel, rel: dict, found: "resolver.Resolution") -> None:
    marker = f"S{rel['season']:02d}E{rel['episode']:02d} {rel['episode_title']}"
    if found.source == resolver.KEPT:
        db.log("WARN", message("event.part_kept", marker=marker), channel_id=channel["id"])
    elif found.episode != rel["episode"]:
        db.log("INFO", message("event.part_resolved", marker=marker, episode=f"E{found.episode:02d}",
                               source=found.source), channel_id=channel["id"])


async def build_resolved_release(channel, msg, fn) -> dict:
    """``build_release`` with a "(Na Part)" episode resolved to TVDB's numbering
    on series channels mapped to TMDB/TVDB ids.

    Adds ``parsed_episode`` (the channel's number) and ``episode_source`` (where
    the published number came from); both None when nothing was resolved."""
    name = await series_name(channel)
    rel = {**build_release(channel, msg, fn, series_name=name),
           "parsed_episode": None, "episode_source": None}
    if not _is_mapped_series(channel):
        return rel
    found = await resolver.resolve_part(tmdb_id=channel["tmdb_id"], tvdb_id=channel["tvdb_id"],
                                        season=rel["season"], episode=rel["episode"],
                                        episode_title=rel["episode_title"])
    if found is None:
        return rel
    _log_resolution(channel, rel, found)
    resolved = rel if found.episode == rel["episode"] else build_release(
        channel, msg, fn, episode=found.episode, series_name=name)
    return {**resolved, "parsed_episode": rel["episode"], "episode_source": found.source}


async def _record_release(channel, msg, size, fn, gk):
    """Index a seen media item so the Newznab endpoint can serve it as a release."""
    rel = await build_resolved_release(channel, msg, fn)
    with db.conn() as c:
        c.execute("""INSERT INTO releases
            (channel_id,message_id,group_key,title,season,episode,quality,size,added_at,
             parsed_episode,episode_source)
            VALUES(?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(channel_id,message_id) DO UPDATE SET
              title=excluded.title, season=excluded.season, episode=excluded.episode,
              quality=excluded.quality, size=excluded.size,
              parsed_episode=excluded.parsed_episode, episode_source=excluded.episode_source""",
            (channel["id"], msg.id, gk, rel["title"], rel["season"], rel["episode"],
             rel["quality"], size, int(time.time()), rel["parsed_episode"], rel["episode_source"]))


def posted_film(channel, msg, size, fn, gk) -> movies.PostedFilm:
    """A movie channel message's film: title/year from the caption, else the file name."""
    caption = msg.message or ""
    from_caption, from_file = extract_movie(caption), extract_movie(fn or "")
    candidates = [m for m in (from_caption, from_file) if m.title]
    movie = next((m for m in candidates if m.year), candidates[0] if candidates else from_file)
    quality = _message_quality(channel, msg, from_caption.quality or from_file.quality)
    return movies.PostedFilm(channel_id=channel["id"], message_id=msg.id, group_key=gk, size=size,
                             file_name=fn, caption=caption, title=movie.title, year=movie.year,
                             quality=quality)


async def _index_release(channel, msg, size, fn, gk) -> bool:
    """Index a seen media item for Newznab. False when it is not offered (pending review)."""
    if not is_tv(channel):
        return await movies.index_message(posted_film(channel, msg, size, fn, gk))
    await _record_release(channel, msg, size, fn, gk)
    return True


async def _enqueue(client, channel, msg, size, fn, gk):
    await enqueue(client, channel, msg, size, fn, gk, _resolve_path(channel, msg, fn))


async def _read_source(client, channel, *, limit, stop_at=0):
    """``_iter_best`` over the source's messages, or None (with the reason in the
    event log) when it is a topic source whose topic is gone or inaccessible."""
    try:
        return await _iter_best(client, channel["chat_id"], limit=limit, stop_at=stop_at,
                                topic_id=channel["topic_id"])
    except Exception as e:
        reason = topic_errors.unreadable_topic(channel, e)
        if reason is None:
            raise
        db.log("ERROR", reason, channel_id=channel["id"])
        return None


async def scan_channel(client, channel):
    cid = channel["id"]
    if not channels.scanning_on(cid):   # `channel` may predate the switch: a pass can take minutes
        return
    last = channel["last_message_id"] or 0
    scanned = await _read_source(client, channel, limit=80, stop_at=last)
    if scanned is None:   # retried at the next poll, not every loop cycle
        with db.conn() as c:
            c.execute("UPDATE channels SET last_scanned_at=? WHERE id=?", (int(time.time()), cid))
        return
    best, max_seen = scanned
    auto_download = not settings.is_arr_mode()   # *arr mode: Sonarr/Radarr decide what to grab
    for gk, (msg, size, fn) in best.items():
        offered = await _index_release(channel, msg, size, fn, gk)
        if offered and auto_download and not _already_have(channel, gk, size):
            await _enqueue(client, channel, msg, size, fn, gk)
    await _retry_failed(client, channel)   # recover transient download failures
    with db.conn() as c:
        c.execute("UPDATE channels SET last_scanned_at=?, last_message_id=? WHERE id=?",
                  (int(time.time()), max_seen, cid))


async def backfill_channel(client, channel, full=True):
    cid = channel["id"]
    scanned = await _read_source(client, channel, limit=None)
    if scanned is None:
        return 0
    best, _ = scanned
    auto_download = not settings.is_arr_mode()   # *arr mode: index only, never auto-grab
    queued = 0
    for gk, (msg, size, fn) in best.items():
        offered = await _index_release(channel, msg, size, fn, gk)
        if not (offered and auto_download) or _already_have(channel, gk, size):
            continue
        await _enqueue(client, channel, msg, size, fn, gk)
        queued += 1
    db.log("INFO", message("event.backfill_done", channel=channel["title"], indexed=len(best), queued=queued),
           channel_id=cid)
    return queued

async def grab_message(channel_id, message_id):
    """On-demand grab used by the SABnzbd shim; returns the row's current attempt
    or None. A re-grab of a failed or cancelled row starts a new attempt."""
    client = get_client()
    if not client.is_connected():
        await client.connect()
    with db.conn() as c:
        ch = c.execute("SELECT * FROM channels WHERE id=?", (channel_id,)).fetchone()
    if not ch:
        return None
    try:
        msg = await client.get_messages(ch["chat_id"], ids=message_id)
    except Exception as e:
        db.log("ERROR", message("event.grab_fetch_failed", error=str(e)), channel_id=channel_id)
        return None
    doc = msg.document or msg.video if msg else None
    if not doc:
        return None
    fn = _file_name(doc, msg.id)
    gk = group_key(msg.message or "", fn, msg.id)
    return queue_grab(client, channel_id, msg, doc.size, fn, gk, _flat_path(ch, msg, fn))


def channel_should_run_today(channel) -> bool:
    import datetime
    wd = datetime.datetime.now().weekday()
    allowed = [int(x) for x in (channel["weekdays"] or "").split(",") if x.strip().isdigit()]
    return wd in allowed if allowed else True

async def scan_loop():
    db.log("INFO", message("event.scanner_started"))
    resumed = False
    while True:
        try:
            client = get_client()                       # re-fetch each cycle so re-auth is picked up
            if not client.is_connected():
                await client.connect()
            if not await client.is_user_authorized():
                await asyncio.sleep(15)                  # wait for the user to connect Telegram
                continue
            if not resumed:                              # resume interrupted downloads once, after auth
                await resume_pending_downloads()
                resumed = True
            if settings.get_bool("paused", False):
                await asyncio.sleep(LOOP_PAUSE_S)
                continue
            now = int(time.time())
            for ch in channels.scannable():
                if not channel_should_run_today(ch):
                    continue
                if not _poll.is_due(ch["id"], ch["last_scanned_at"] or 0, ch["poll_minutes"], now):
                    continue
                try:
                    await scan_channel(client, ch)
                except Exception as e:
                    db.log("ERROR", message("event.scan_failed", channel=ch["title"], error=str(e)), channel_id=ch["id"])
        except Exception as e:
            db.log("ERROR", message("event.scan_loop_error", error=str(e)))
        await asyncio.sleep(LOOP_PAUSE_S)


def start_background():
    global _active
    if _active and not _active.done():
        return _active
    _active = asyncio.create_task(scan_loop())
    return _active


def is_alive() -> bool:
    """True while the background scan loop is running (for the System panel)."""
    return _active is not None and not _active.done()
