# app/scanner.py — channel scanner + download orchestrator.
#
# NOTE: this module keeps process-wide asyncio state (semaphore, in-flight set,
# task registry). It is correct ONLY under a single event loop / single uvicorn
# worker. The container runs `--workers 1`; do not raise that without moving the
# scanner into its own process.
import contextlib
import os
import time
import asyncio
import logging
from enum import Enum
from typing import Any, NamedTuple

from . import db, plex, notify, settings, safety, resolver, movies, topic_errors
from .arr import AttemptRef, category_for, hide_from_history, is_current_attempt
from .i18n import message, translate
from .series_titles import cached_series_name, display_title, is_tv, series_name
from .tg import get_client, source_messages
from .namer import (group_key, message_episode, extract_episode_title,
                    build_save_path, flat_save_path, is_uhd, release_name, quality_from_dims,
                    DEFAULT_LANGUAGE, extract_movie)
from .config import (TV_DIR, TV_DIR_4K, MOVIES_DIR, MOVIES_DIR_4K, OTHER_DIR,
                     MAX_CONCURRENT_DOWNLOADS)
from .downloader import download_file

log = logging.getLogger("scanner")

_active = None
_queue_lock = asyncio.Lock()
_inflight = {}                          # (channel_id, group_key) -> _SlotHolder
_sem = asyncio.Semaphore(MAX_CONCURRENT_DOWNLOADS)
_sem_limit = MAX_CONCURRENT_DOWNLOADS
_task_registry = {}                     # download_id -> asyncio.Task
_bg_tasks = set()                       # strong refs so backfill isn't GC'd
_shutting_down = False                  # set on graceful shutdown
MAX_DOWNLOAD_RETRIES = 3                 # auto-retry a failed download this many times
_poll = safety.PollScheduler()          # 15-min floor + per-scan random jitter
DEFAULT_SEASON = 1                      # season of an episode-only series release
ON_DISK_RATIO = 0.98                    # a file this complete on disk counts as already downloaded
BUDGET_RECHECK_SECONDS = 60             # how often a budget-paused download re-checks the budget
MESSAGE_GONE = "dl.err.message_gone"     # download reasons (i18n keys)
CANCELLED_BY_USER = "dl.err.cancelled"
DOWNLOAD_FAILED = "dl.err.failed"
DUPLICATE_IN_FLIGHT = "dl.err.duplicate"   # same episode already downloading from another message
STALLED_HANDOFF = "dl.err.stalled_handoff"   # the previous attempt's task never stopped
NOT_REQUEUED = "dl.not_requeued"         # why a Retry re-queued nothing (with MESSAGE_GONE)
SLOT_HANDOFF_TIMEOUT_SECONDS = 60       # how long a new attempt waits for the previous one to stop


class RetryCount(Enum):
    """What re-queuing a stopped row does to its auto-retry count (an SQL expression)."""
    RESET = "0"                          # a user's Retry: the full auto-retry budget again
    KEEP = "retry_count"                 # an *arr re-grab
    BUMP = "COALESCE(retry_count,0)+1"   # an auto-retry uses one up


def begin_shutdown():
    """Mark a graceful shutdown so interrupted downloads requeue (not cancel)."""
    global _shutting_down
    _shutting_down = True


def _sem_current():
    """Semaphore sized from the live max_concurrent setting (rebuilt on change)."""
    global _sem, _sem_limit
    want = settings.get_int("max_concurrent", MAX_CONCURRENT_DOWNLOADS)
    if want != _sem_limit:
        _sem = asyncio.Semaphore(want)
        _sem_limit = want
    return _sem


def pause():
    settings.set("paused", "1")


async def resume_all():
    settings.set("paused", "0")
    await resume_pending_downloads()


def _spawn(coro):
    t = asyncio.create_task(coro)
    _bg_tasks.add(t)
    t.add_done_callback(_bg_tasks.discard)
    return t


def register_task(dl_id, task):
    _task_registry[dl_id] = task
    task.add_done_callback(lambda t, i=dl_id: _unregister_task(i, t))


def _unregister_task(dl_id, task) -> None:
    """Drop the registration only while it still points at ``task``."""
    if _task_registry.get(dl_id) is task:
        del _task_registry[dl_id]


def requeue_stopped(c, dl_id: int, retry_count: RetryCount) -> int | None:
    """Re-queue a failed or cancelled row as a new attempt and return that attempt:
    the *arr tracks it under a fresh download id, shown in its history again. The
    status-conditional UPDATE leaves a row that is already queued or downloading
    untouched (None)."""
    stopped = db.STOPPED_STATUSES
    row = c.execute(
        "UPDATE downloads SET status='queued', progress=0, speed_mbs=0, error=NULL, "
        "error_key=NULL, error_params=NULL, attempt=attempt+1, arr_hidden=0, "
        f"retry_count={retry_count.value} "
        f"WHERE id=? AND status IN ({db.placeholders(stopped)}) RETURNING attempt",
        (dl_id, *stopped)).fetchone()
    return row["attempt"] if row else None


def cancel_download(dl_id: int) -> bool:
    """Stop a download: cancel its running task or, with none, the row while it
    waits queued (held while downloads are paused). False when there was
    nothing to stop."""
    t = _task_registry.get(dl_id)
    if t and not t.done():
        t.cancel()
        return True
    ref = _current_ref(dl_id)
    if ref is None:
        return False
    with db.conn() as c:
        return _set_attempt_error(c, ref, "cancelled", message(CANCELLED_BY_USER),
                                  from_statuses=("queued",))


def delete_for_arr(ref: AttemptRef) -> None:
    """A SABnzbd delete of ``ref``. A finished row is only hidden from *arr
    history (never its files); a queued or downloading one is cancelled at once,
    so a Retry may follow before its task has wound down. An id from an earlier
    attempt changes nothing."""
    if hide_from_history(*ref) or not is_current_attempt(*ref):
        return
    cancel_download(ref.download_id)
    with db.conn() as c:
        _set_attempt_error(c, ref, "cancelled", message(CANCELLED_BY_USER),
                           from_statuses=db.ACTIVE_STATUSES)


async def retry_download(dl_id: int) -> str | None:
    """A user's Retry: re-queue a stopped download as a new attempt. None when
    it was re-queued, else the i18n key of why not. The row's status is checked
    before Telegram is asked for the message, so retrying an active row is a
    no-op even with Telegram down; ``requeue_stopped`` re-checks it, so racing
    requests can't reset a row that is already queued or downloading."""
    with db.conn() as c:
        row = c.execute("""SELECT d.*, c.chat_id FROM downloads d
                           JOIN channels c ON c.id=d.channel_id WHERE d.id=?""",
                        (dl_id,)).fetchone()
    if row is None or row["status"] not in db.STOPPED_STATUSES:
        return NOT_REQUEUED
    client = get_client()
    if not client.is_connected():
        await client.connect()
    msg = await client.get_messages(row["chat_id"], ids=row["message_id"])
    if not msg:
        return MESSAGE_GONE
    with db.conn() as c:
        if requeue_stopped(c, dl_id, RetryCount.RESET) is None:
            return NOT_REQUEUED
    _spawn(_run_download(client, row["channel_id"], msg, row["save_path"], row["group_key"]))
    return None


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
    cid = channel["id"]
    save_path = _resolve_path(channel, msg, fn)
    if os.path.exists(save_path) and os.path.getsize(save_path) >= size * 0.98:
        with db.conn() as c:
            c.execute("""INSERT OR IGNORE INTO downloads
                (channel_id,message_id,group_key,file_name,file_size,save_path,
                 status,progress,created_at,finished_at)
                VALUES(?,?,?,?,?,?,?,?,?,?)""",
                (cid, msg.id, gk, fn, size, save_path, "completed", 1.0,
                 int(time.time()), int(time.time())))
        return
    with db.conn() as c:
        c.execute("""INSERT OR IGNORE INTO downloads
            (channel_id,message_id,group_key,file_name,file_size,save_path,status,created_at)
            VALUES(?,?,?,?,?,?,?,?)""",
            (cid, msg.id, gk, fn, size, save_path, "queued", int(time.time())))
    db.log("INFO", message("event.queued", file=fn, size=f"{size/1e9:.2f}", path=save_path), channel_id=cid)
    _spawn(_run_download(client, cid, msg, save_path, gk))


async def _retry_failed(client, channel):
    """Re-queue this channel's failed downloads (transient drive/network blips)
    up to MAX_DOWNLOAD_RETRIES. _run_download finalizes any that are already on
    disk instead of re-downloading."""
    cid = channel["id"]
    with db.conn() as c:
        rows = c.execute(
            "SELECT id, message_id, save_path, group_key, file_name, "
            "COALESCE(retry_count,0) AS rc FROM downloads "
            "WHERE channel_id=? AND status='failed' AND COALESCE(retry_count,0) < ?",
            (cid, MAX_DOWNLOAD_RETRIES)).fetchall()
    for r in rows:
        try:
            msg = await client.get_messages(channel["chat_id"], ids=r["message_id"])
        except Exception as e:
            db.log("WARN", message("event.retry_fetch_failed", message_id=r["message_id"], error=str(e)),
                   channel_id=cid)
            continue
        if not msg:
            with db.conn() as c:
                _set_error(c, r["id"], "failed", message(MESSAGE_GONE))
            continue
        with db.conn() as c:
            if requeue_stopped(c, r["id"], RetryCount.BUMP) is None:
                continue
        db.log("INFO", message("event.auto_retry", n=r["rc"] + 1, max=MAX_DOWNLOAD_RETRIES, file=r["file_name"]),
               channel_id=cid)
        _spawn(_run_download(client, cid, msg, r["save_path"], r["group_key"]))


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


def _write_reason(c, status: str, reason: dict, where: str, args: tuple) -> bool:
    """Set the status and reason (stored as a key the UI translates) of the rows
    ``where`` matches; True if one changed."""
    text, key, params = db.keyed(reason)
    cur = c.execute("UPDATE downloads SET status=?, error=?, error_key=?, error_params=? "
                    f"WHERE {where}", (status, text, key, params, *args))
    return cur.rowcount > 0


def _set_error(c, dl_id: int, status: str, reason: dict) -> None:
    """Set a download's status and its reason, whatever attempt it is on."""
    _write_reason(c, status, reason, "id=?", (dl_id,))


def _set_attempt_error(c, ref: AttemptRef, status: str, reason: dict, *,
                       from_statuses: tuple = ()) -> bool:
    """:func:`_set_error` for one attempt only: a download task's writes must not
    land on a newer attempt that a retry started. With ``from_statuses``, only
    while the row is in one of them. True if the row changed."""
    where = "id=? AND attempt=?"
    if from_statuses:
        where += f" AND status IN ({db.placeholders(from_statuses)})"
    return _write_reason(c, status, reason, where, (*ref, *from_statuses))


def _update_attempt(ref: AttemptRef, assignments: str, *values) -> None:
    """``UPDATE downloads SET <assignments>`` for one attempt at a row."""
    with db.conn() as c:
        c.execute(f"UPDATE downloads SET {assignments} WHERE id=? AND attempt=?", (*values, *ref))


async def _wait_for_budget(ref: AttemptRef) -> None:
    """Hold a download (status queued, reason in `error`) until the daily budget allows it."""
    marked = False
    while safety.budget_exhausted():
        if not marked:
            resets = time.strftime("%H:%M", time.localtime(safety.budget_status()["resets_at"]))
            with db.conn() as c:
                _set_attempt_error(c, ref, "queued", message("budget.download_held", resets=resets))
            marked = True
        await asyncio.sleep(BUDGET_RECHECK_SECONDS)


def _remove_partial(save_path: str) -> None:
    with contextlib.suppress(OSError):
        os.remove(save_path + ".tmp")


class _Run(NamedTuple):
    """What one download task works on: a channel message's file, for one attempt at its row."""
    channel_id: int
    msg: Any
    save_path: str
    ref: AttemptRef


def _finish_if_on_disk(run: _Run, fsize: int) -> bool:
    """Mark the download complete when its file is already on disk.

    Covers a file fully downloaded but not finalized before a crash/restart, or
    grabbed by a sibling source; re-downloading it used to loop forever,
    re-writing a full .tmp and stalling at the finalize step."""
    path = run.save_path
    if not (fsize and os.path.exists(path) and os.path.getsize(path) >= fsize * ON_DISK_RATIO):
        return False
    _remove_partial(path)
    _update_attempt(run.ref, "status='completed', progress=1.0, speed_mbs=0, finished_at=?",
                    int(time.time()))
    db.log("INFO", message("event.already_on_disk", file=os.path.basename(path)),
           channel_id=run.channel_id)
    return True


async def _fetch(client, run: _Run, fsize: int) -> None:
    """Download the message's file to `save_path`, keeping the row's progress current."""
    _update_attempt(run.ref, "status='downloading', started_at=?, error=NULL, "
                    "error_key=NULL, error_params=NULL", int(time.time()))

    async def progress(pct, speed):
        _update_attempt(run.ref, "progress=?, speed_mbs=?", pct, speed)

    await download_file(client, run.msg, run.save_path, progress_cb=progress)
    safety.record_download(fsize)
    _update_attempt(run.ref, "status='completed', progress=1.0, finished_at=?", int(time.time()))


def _announce_completed(channel_id: int, save_path: str) -> None:
    """Log the finished file, prune history, refresh Plex and send the notification."""
    name = os.path.basename(save_path)
    db.log("INFO", message("event.downloaded", file=name), channel_id=channel_id)
    _prune_history(channel_id)
    with db.conn() as c:
        ch = c.execute("SELECT imdb_id, imdb_title, title FROM channels WHERE id=?", (channel_id,)).fetchone()
    show = (ch["imdb_title"] or ch["title"]) if ch else ""
    _spawn(plex.refresh_path(os.path.dirname(save_path)))
    _spawn(notify.send(translate("notify.downloaded"), name, imdb_id=(ch["imdb_id"] if ch else None), show=show))


def _on_cancelled(run: _Run) -> None:
    if _shutting_down:
        # process is stopping — leave it queued so it resumes on next boot
        _update_attempt(run.ref, "status='queued', progress=0, speed_mbs=0")
        return
    with db.conn() as c:
        _set_attempt_error(c, run.ref, "cancelled", message(CANCELLED_BY_USER))
    _remove_partial(run.save_path)
    db.log("WARN", message("event.cancelled", file=os.path.basename(run.save_path)),
           channel_id=run.channel_id)


def _on_failed(run: _Run, error: Exception) -> None:
    with db.conn() as c:
        _set_attempt_error(c, run.ref, "failed", message(DOWNLOAD_FAILED, error=str(error)))
    db.log("ERROR", message("event.download_failed", error=str(error)), channel_id=run.channel_id)


class _SlotHolder(NamedTuple):
    """The task holding an episode's in-flight slot, and the attempt it downloads."""
    ref: AttemptRef
    task: asyncio.Task


def _download_ref(channel_id: int, message_id: int) -> AttemptRef | None:
    with db.conn() as c:
        row = c.execute("SELECT id, attempt FROM downloads WHERE channel_id=? AND message_id=?",
                        (channel_id, message_id)).fetchone()
    return AttemptRef(row["id"], row["attempt"]) if row else None


def _current_ref(dl_id: int) -> AttemptRef | None:
    with db.conn() as c:
        row = c.execute("SELECT id, attempt FROM downloads WHERE id=?", (dl_id,)).fetchone()
    return AttemptRef(row["id"], row["attempt"]) if row else None


def _still_wanted(ref: AttemptRef) -> bool:
    """True while the row is on attempt ``ref`` and not stopped. A cancel that
    finds no registered task cancels the row instead, so a task checks this
    before it starts and again once it holds the slot (it may have waited)."""
    with db.conn() as c:
        row = c.execute("SELECT status FROM downloads WHERE id=? AND attempt=?", (*ref,)).fetchone()
    return row is not None and row["status"] not in db.STOPPED_STATUSES


def _supersedes(ref: AttemptRef, holder: AttemptRef) -> bool:
    """True when ``ref`` is a newer attempt at the row ``holder`` is downloading."""
    return ref.download_id == holder.download_id and ref.attempt > holder.attempt


def _resolve_inflight_loser(ref: AttemptRef, holder: AttemptRef) -> None:
    """A task lost the in-flight slot for its episode. A duplicate task for the
    row already downloading (or a stale one for an earlier attempt) changes
    nothing; a row for another message of the same episode is cancelled with a
    reason, so it isn't left queued with no task behind it (and isn't resumed
    into the same race after a restart)."""
    if ref.download_id == holder.download_id:
        return
    with db.conn() as c:   # only a row still waiting: a finished row keeps its outcome
        _set_attempt_error(c, ref, "cancelled", message(DUPLICATE_IN_FLIGHT),
                           from_statuses=("queued",))


def _fail_stalled_handoff(ref: AttemptRef, holder: AttemptRef) -> None:
    """The previous attempt's task never wound down: fail the new attempt with
    a reason rather than wait forever (a later retry may take over)."""
    log.warning("download %s attempt %s: attempt %s still holds the slot after %ss",
                ref.download_id, ref.attempt, holder.attempt, SLOT_HANDOFF_TIMEOUT_SECONDS)
    with db.conn() as c:
        _set_attempt_error(c, ref, "failed", message(STALLED_HANDOFF), from_statuses=("queued",))


async def _claim_slot(key, ref: AttemptRef) -> bool:
    """Take the in-flight slot for an episode; False when this task lost it. A
    newer attempt at the row holding the slot (a retry right after a cancel)
    waits for the older attempt's task to finish winding down, then claims it;
    it gives up after SLOT_HANDOFF_TIMEOUT_SECONDS."""
    me = asyncio.current_task()
    while True:
        async with _queue_lock:
            holder = _inflight.get(key)
            if holder is None:
                _inflight[key] = _SlotHolder(ref, me)
                register_task(ref.download_id, me)
                return True
            if not _supersedes(ref, holder.ref):
                _resolve_inflight_loser(ref, holder.ref)
                return False   # another task owns this episode; leave its cancel registration alone
            register_task(ref.download_id, me)   # a cancel of the new attempt stops this task
        done, _ = await asyncio.wait({holder.task}, timeout=SLOT_HANDOFF_TIMEOUT_SECONDS)
        if not done:
            _fail_stalled_handoff(ref, holder.ref)
            return False


def _release_slot(key) -> None:
    """Free the episode's in-flight slot if this task holds it. Synchronous (no
    await between it and the stopped status), so a retry can never find the row
    stopped while its finishing task still holds the slot."""
    holder = _inflight.get(key)
    if holder is not None and holder.task is asyncio.current_task():
        del _inflight[key]


async def _run_download(client, channel_id, msg, save_path, gk):
    ref = _download_ref(channel_id, msg.id)   # every write below is scoped to this attempt
    if ref is None or not _still_wanted(ref):
        return   # deleted or cancelled before its task started
    if settings.get_bool("paused", False):
        _update_attempt(ref, "status='queued'")
        return
    run = _Run(channel_id, msg, save_path, ref)
    key = (channel_id, gk)
    try:
        if not await _claim_slot(key, ref) or not _still_wanted(ref):
            return
        await _wait_for_budget(ref)
        async with _sem_current():
            doc = msg.document or msg.video
            fsize = doc.size if doc else 0
            if _finish_if_on_disk(run, fsize):
                return
            await _fetch(client, run, fsize)
            _announce_completed(channel_id, save_path)
    except asyncio.CancelledError:
        _release_slot(key)   # before the stopped status: a retry may follow at once
        _on_cancelled(run)
        raise
    except Exception as e:
        _release_slot(key)
        _on_failed(run, e)
    finally:
        _release_slot(key)


def _prune_history(channel_id):
    """Keep only the newest N completed records per channel (files on disk are kept)."""
    lim = settings.get_int("history_limit_per_show", 0)
    if lim <= 0:
        return
    with db.conn() as c:
        c.execute("""DELETE FROM downloads WHERE channel_id=? AND status='completed' AND id NOT IN
                     (SELECT id FROM downloads WHERE channel_id=? AND status='completed'
                      ORDER BY COALESCE(finished_at, created_at) DESC, id DESC LIMIT ?)""",
                  (channel_id, channel_id, lim))


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
    save_path = _flat_path(ch, msg, fn)
    with db.conn() as c:
        c.execute("""INSERT OR IGNORE INTO downloads
            (channel_id,message_id,group_key,file_name,file_size,save_path,status,created_at)
            VALUES(?,?,?,?,?,?,?,?)""",
            (channel_id, msg.id, gk, fn, doc.size, save_path, "queued", int(time.time())))
        row = c.execute("SELECT id, status, attempt FROM downloads "
                        "WHERE channel_id=? AND message_id=?", (channel_id, msg.id)).fetchone()
        ref = None
        if row:
            stopped = row["status"] in db.STOPPED_STATUSES
            requeued = requeue_stopped(c, row["id"], RetryCount.KEEP) if stopped else None
            ref = AttemptRef(row["id"], row["attempt"] if requeued is None else requeued)
    db.log("INFO", message("event.grab_queued", file=fn), channel_id=channel_id)
    _spawn(_run_download(client, channel_id, msg, save_path, gk))
    return ref


def channel_should_run_today(channel) -> bool:
    import datetime
    wd = datetime.datetime.now().weekday()
    allowed = [int(x) for x in (channel["weekdays"] or "").split(",") if x.strip().isdigit()]
    return wd in allowed if allowed else True


async def resume_pending_downloads():
    client = get_client()
    if not client.is_connected():
        await client.connect()
    with db.conn() as c:
        c.execute("UPDATE downloads SET status='queued', progress=0, speed_mbs=0 "
                  "WHERE status='downloading'")
        rows = c.execute("""SELECT d.*, c.chat_id FROM downloads d
                            JOIN channels c ON c.id=d.channel_id
                            WHERE d.status='queued' ORDER BY d.id ASC""").fetchall()
    db.log("INFO", message("event.resuming", n=len(rows)))
    for r in rows:
        try:
            msg = await client.get_messages(r["chat_id"], ids=r["message_id"])
            if not msg:
                with db.conn() as c:
                    _set_error(c, r["id"], "failed", message(MESSAGE_GONE))
                continue
            _spawn(_run_download(client, r["channel_id"], msg, r["save_path"], r["group_key"]))
        except Exception as e:
            db.log("ERROR", message("event.resume_failed", message_id=r["message_id"], error=str(e)))


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
                await asyncio.sleep(30)
                continue
            now = int(time.time())
            with db.conn() as c:
                rows = c.execute("SELECT * FROM channels WHERE enabled=1").fetchall()
            for ch in rows:
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
        await asyncio.sleep(30)


def start_background():
    global _active
    if _active and not _active.done():
        return _active
    _active = asyncio.create_task(scan_loop())
    return _active


def is_alive() -> bool:
    """True while the background scan loop is running (for the System panel)."""
    return _active is not None and not _active.done()
