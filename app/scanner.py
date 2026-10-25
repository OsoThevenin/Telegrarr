# app/scanner.py — channel scanner + download orchestrator.
#
# NOTE: this module keeps process-wide asyncio state (semaphore, in-flight set,
# task registry). It is correct ONLY under a single event loop / single uvicorn
# worker. The container runs `--workers 1`; do not raise that without moving the
# scanner into its own process.
import os
import time
import asyncio
import logging

from . import db, plex, notify, settings, safety
from .tg import get_client
from .namer import (group_key, extract_episode, extract_episode_title,
                    build_save_path, is_uhd, release_name)
from .config import (TV_DIR, TV_DIR_4K, MOVIES_DIR, MOVIES_DIR_4K, OTHER_DIR,
                     MAX_CONCURRENT_DOWNLOADS)
from .downloader import download_file

log = logging.getLogger("scanner")

_active = None
_queue_lock = asyncio.Lock()
_inflight = set()                       # (channel_id, group_key)
_sem = asyncio.Semaphore(MAX_CONCURRENT_DOWNLOADS)
_sem_limit = MAX_CONCURRENT_DOWNLOADS
_task_registry = {}                     # download_id -> asyncio.Task
_bg_tasks = set()                       # strong refs so backfill isn't GC'd
_shutting_down = False                  # set on graceful shutdown
MAX_DOWNLOAD_RETRIES = 3                 # auto-retry a failed download this many times
_poll = safety.PollScheduler()          # 15-min floor + per-scan random jitter


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
    task.add_done_callback(lambda _t, i=dl_id: _task_registry.pop(i, None))


def cancel_download(dl_id) -> bool:
    t = _task_registry.get(dl_id)
    if t and not t.done():
        t.cancel()
        return True
    return False


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


def _resolve_path(channel, msg, fn):
    info = extract_episode(fn) if fn else {}
    if not info.get("season"):
        info = extract_episode(msg.message or "")
    show = channel["imdb_title"] or channel["title"]
    ep_title = extract_episode_title(msg.message or "", fn,
                                     info.get("season") or 0,
                                     info.get("episode") or 0, show_title=show)
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


async def _iter_best(client, chat_id, *, limit, stop_at=0):
    """Yield newest→older media, keeping only the largest file per group_key."""
    best = {}
    max_seen = stop_at
    async for msg in client.iter_messages(chat_id, limit=limit):
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


def _record_release(channel, msg, size, fn, gk):
    """Index a seen media item so the Newznab endpoint can serve it as a release."""
    info = extract_episode(fn) if fn else {}
    if not info.get("season"):
        info = extract_episode(msg.message or "")
    show = channel["imdb_title"] or channel["title"]
    title = release_name(show, info.get("season") or 0, info.get("episode") or 0,
                         info.get("quality") or "", channel["kind"])
    with db.conn() as c:
        c.execute("""INSERT INTO releases
            (channel_id,message_id,group_key,title,season,episode,quality,size,added_at)
            VALUES(?,?,?,?,?,?,?,?,?)
            ON CONFLICT(channel_id,message_id) DO UPDATE SET
              title=excluded.title, season=excluded.season, episode=excluded.episode,
              quality=excluded.quality, size=excluded.size""",
            (channel["id"], msg.id, gk, title, info.get("season"), info.get("episode"),
             info.get("quality"), size, int(time.time())))


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
    db.log("INFO", f"Queued {fn} ({size/1e9:.2f}GB) → {save_path}", channel_id=cid)
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
            db.log("WARN", f"Auto-retry: could not fetch msg {r['message_id']}: {e}", channel_id=cid)
            continue
        if not msg:
            with db.conn() as c:
                c.execute("UPDATE downloads SET status='failed', error='message gone' WHERE id=?", (r["id"],))
            continue
        with db.conn() as c:
            c.execute("UPDATE downloads SET status='queued', progress=0, speed_mbs=0, error=NULL, "
                      "retry_count=COALESCE(retry_count,0)+1 WHERE id=?", (r["id"],))
        db.log("INFO", f"Auto-retry {r['rc'] + 1}/{MAX_DOWNLOAD_RETRIES}: {r['file_name']}", channel_id=cid)
        _spawn(_run_download(client, cid, msg, r["save_path"], r["group_key"]))


async def scan_channel(client, channel):
    cid = channel["id"]
    last = channel["last_message_id"] or 0
    best, max_seen = await _iter_best(client, channel["chat_id"], limit=80, stop_at=last)
    for gk, (msg, size, fn) in best.items():
        _record_release(channel, msg, size, fn, gk)
        if not _already_have(channel, gk, size):
            await _enqueue(client, channel, msg, size, fn, gk)
    await _retry_failed(client, channel)   # recover transient download failures
    with db.conn() as c:
        c.execute("UPDATE channels SET last_scanned_at=?, last_message_id=? WHERE id=?",
                  (int(time.time()), max_seen, cid))


async def backfill_channel(client, channel, full=True):
    cid = channel["id"]
    best, _ = await _iter_best(client, channel["chat_id"], limit=None)
    queued = 0
    for gk, (msg, size, fn) in best.items():
        _record_release(channel, msg, size, fn, gk)
        if _already_have(channel, gk, size):
            continue
        await _enqueue(client, channel, msg, size, fn, gk)
        queued += 1
    db.log("INFO", f"[Backfill] {channel['title']}: {queued} new queued.", channel_id=cid)
    return queued


async def _run_download(client, channel_id, msg, save_path, gk):
    key = (channel_id, gk)
    with db.conn() as c:
        row = c.execute("SELECT id FROM downloads WHERE channel_id=? AND message_id=?",
                        (channel_id, msg.id)).fetchone()
    if row:
        register_task(row["id"], asyncio.current_task())

    if settings.get_bool("paused", False):
        with db.conn() as c:
            c.execute("UPDATE downloads SET status='queued' WHERE channel_id=? AND message_id=?",
                      (channel_id, msg.id))
        return

    async with _queue_lock:
        if key in _inflight:
            return
        _inflight.add(key)
    try:
        async with _sem_current():
            # If the finished file is already on disk — fully downloaded but not
            # finalized before a crash/restart, or grabbed by a sibling source —
            # mark it complete instead of re-downloading (which previously looped
            # forever, re-writing a full .tmp and stalling at the finalize step).
            doc = msg.document or msg.video
            fsize = doc.size if doc else 0
            if fsize and os.path.exists(save_path) and os.path.getsize(save_path) >= fsize * 0.98:
                tmp = save_path + ".tmp"
                if os.path.exists(tmp):
                    try:
                        os.remove(tmp)
                    except OSError:
                        pass
                with db.conn() as c:
                    c.execute("""UPDATE downloads SET status='completed', progress=1.0, speed_mbs=0,
                                 finished_at=? WHERE channel_id=? AND message_id=?""",
                              (int(time.time()), channel_id, msg.id))
                db.log("INFO", f"Already on disk — finalized {os.path.basename(save_path)}", channel_id=channel_id)
                return
            with db.conn() as c:
                c.execute("""UPDATE downloads SET status='downloading', started_at=?
                             WHERE channel_id=? AND message_id=?""",
                          (int(time.time()), channel_id, msg.id))

            async def pcb(pct, speed):
                with db.conn() as c:
                    c.execute("""UPDATE downloads SET progress=?, speed_mbs=?
                                 WHERE channel_id=? AND message_id=?""",
                              (pct, speed, channel_id, msg.id))

            await download_file(client, msg, save_path, progress_cb=pcb)

            with db.conn() as c:
                c.execute("""UPDATE downloads SET status='completed', progress=1.0,
                             finished_at=? WHERE channel_id=? AND message_id=?""",
                          (int(time.time()), channel_id, msg.id))
            name = os.path.basename(save_path)
            db.log("INFO", f"✅ Downloaded {name}", channel_id=channel_id)
            _prune_history(channel_id)
            with db.conn() as c:
                ch = c.execute("SELECT imdb_id, imdb_title, title FROM channels WHERE id=?", (channel_id,)).fetchone()
            show = (ch["imdb_title"] or ch["title"]) if ch else ""
            _spawn(plex.refresh_path(os.path.dirname(save_path)))
            _spawn(notify.send("Downloaded", name, imdb_id=(ch["imdb_id"] if ch else None), show=show))
    except asyncio.CancelledError:
        if _shutting_down:
            # process is stopping — leave it queued so it resumes on next boot
            with db.conn() as c:
                c.execute("""UPDATE downloads SET status='queued', progress=0, speed_mbs=0
                             WHERE channel_id=? AND message_id=?""", (channel_id, msg.id))
        else:
            with db.conn() as c:
                c.execute("""UPDATE downloads SET status='cancelled', error='cancelled by user'
                             WHERE channel_id=? AND message_id=?""", (channel_id, msg.id))
            tmp = save_path + ".tmp"
            try:
                if os.path.exists(tmp):
                    os.remove(tmp)
            except Exception:
                pass
            db.log("WARN", f"Cancelled {os.path.basename(save_path)}", channel_id=channel_id)
        raise
    except Exception as e:
        with db.conn() as c:
            c.execute("""UPDATE downloads SET status='failed', error=?
                         WHERE channel_id=? AND message_id=?""",
                      (str(e), channel_id, msg.id))
        db.log("ERROR", f"Download failed: {e}", channel_id=channel_id)
    finally:
        async with _queue_lock:
            _inflight.discard(key)


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
    """On-demand grab used by the SABnzbd shim; returns the download row id or None."""
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
        db.log("ERROR", f"[arr] grab fetch failed: {e}", channel_id=channel_id)
        return None
    doc = msg.document or msg.video if msg else None
    if not doc:
        return None
    fn = _file_name(doc, msg.id)
    gk = group_key(msg.message or "", fn, msg.id)
    save_path = _resolve_path(ch, msg, fn)
    with db.conn() as c:
        c.execute("""INSERT OR IGNORE INTO downloads
            (channel_id,message_id,group_key,file_name,file_size,save_path,status,created_at)
            VALUES(?,?,?,?,?,?,?,?)""",
            (channel_id, msg.id, gk, fn, doc.size, save_path, "queued", int(time.time())))
        row = c.execute("SELECT id FROM downloads WHERE channel_id=? AND message_id=?",
                        (channel_id, msg.id)).fetchone()
    db.log("INFO", f"[arr] Grab queued {fn}", channel_id=channel_id)
    _spawn(_run_download(client, channel_id, msg, save_path, gk))
    return row["id"] if row else None


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
    db.log("INFO", f"Resuming {len(rows)} queued downloads")
    for r in rows:
        try:
            msg = await client.get_messages(r["chat_id"], ids=r["message_id"])
            if not msg:
                with db.conn() as c:
                    c.execute("UPDATE downloads SET status='failed', error='message gone' "
                              "WHERE id=?", (r["id"],))
                continue
            _spawn(_run_download(client, r["channel_id"], msg, r["save_path"], r["group_key"]))
        except Exception as e:
            db.log("ERROR", f"Resume failed for msg {r['message_id']}: {e}")


async def scan_loop():
    db.log("INFO", "Scanner started")
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
                    db.log("ERROR", f"Scan failed for {ch['title']}: {e}", channel_id=ch["id"])
        except Exception as e:
            db.log("ERROR", f"Scan loop error: {e}")
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
