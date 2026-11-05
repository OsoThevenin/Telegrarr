# app/transfers.py — the transfer lifecycle: queue, run, cancel, retry, resume.
#
# NOTE: this module keeps process-wide asyncio state (semaphore, in-flight set,
# task registry). It is correct ONLY under a single event loop / single uvicorn
# worker. The container runs `--workers 1`; do not raise that without moving the
# transfers into their own process.
import contextlib
import os
import time
import asyncio
import logging
from enum import Enum
from typing import Any, NamedTuple

from telethon.errors import FloodWaitError

from . import db, downloader, plex, notify, settings, safety
from .arr import AttemptRef, hide_from_history, is_current_attempt
from .i18n import message, translate
from .tg import get_client
from .config import MAX_CONCURRENT_DOWNLOADS
from .downloader import download_file

log = logging.getLogger("transfers")

_queue_lock = asyncio.Lock()
_inflight = {}                          # (channel_id, group_key) -> _SlotHolder
_sem = asyncio.Semaphore(MAX_CONCURRENT_DOWNLOADS)
_sem_limit = MAX_CONCURRENT_DOWNLOADS
_task_registry = {}                     # download_id -> asyncio.Task
_bg_tasks = set()                       # strong refs so backfill isn't GC'd
_shutting_down = False                  # set on graceful shutdown
MAX_DOWNLOAD_RETRIES = 3                 # auto-retry a failed download this many times
ON_DISK_RATIO = 0.98                    # a file this complete on disk counts as already downloaded
BUDGET_RECHECK_SECONDS = 60             # how often a budget-paused download re-checks the budget
MESSAGE_GONE = "dl.err.message_gone"     # download reasons (i18n keys)
CANCELLED_BY_USER = "dl.err.cancelled"
DOWNLOAD_FAILED = "dl.err.failed"
DUPLICATE_IN_FLIGHT = "dl.err.duplicate"   # same episode already downloading from another message
STALLED_HANDOFF = "dl.err.stalled_handoff"   # the previous run's task never stopped
NOT_REQUEUED = "dl.not_requeued"         # why a Retry re-queued nothing (with MESSAGE_GONE)
NOT_PAUSED = "dl.not_paused"             # why a Resume re-queued nothing (with MESSAGE_GONE)
SLOT_HANDOFF_TIMEOUT_SECONDS = 60       # how long a new run waits for the previous one to stop


class RunRef(NamedTuple):
    """One run of a download row: every re-queue starts a new one, and a download
    task writes only to its own. An attempt, by contrast, is what the *arr tracks:
    a resume is a new run of the same attempt, as the *arr never wrote a paused row off."""
    download_id: int
    run: int


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


def spawn(coro):
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


def requeue_stopped(c, dl_id: int, retry_count: RetryCount,
                    stopped: tuple = db.STOPPED_STATUSES) -> int | None:
    """Re-queue a row in one of the ``stopped`` statuses (failed or cancelled by
    default) as a new run and return its attempt. A failed or cancelled row also
    starts a new attempt: the *arr wrote the old one off, so it tracks this one
    under a fresh download id, shown in its history again. A paused row keeps its
    id. The status-conditional UPDATE leaves a row in any other status, such as
    already queued or downloading, untouched (None)."""
    written_off = db.STOPPED_STATUSES
    row = c.execute(
        "UPDATE downloads SET status='queued', progress=0, speed_mbs=0, error=NULL, "
        "error_key=NULL, error_params=NULL, run=run+1, "
        f"attempt=attempt+(status IN ({db.placeholders(written_off)})), arr_hidden=0, "
        f"retry_count={retry_count.value} "
        f"WHERE id=? AND status IN ({db.placeholders(stopped)}) RETURNING attempt",
        (*written_off, dl_id, *stopped)).fetchone()
    return row["attempt"] if row else None


def cancel_download(dl_id: int) -> bool:
    """Stop a download: cancel its running task and, with none, the row while it
    waits queued (held while downloads are paused). A paused row is cancelled
    either way: a task still winding down would leave it paused. False when
    there was nothing to stop."""
    t = _task_registry.get(dl_id)
    running = t is not None and not t.done()
    if running:
        t.cancel()
    ref = _current_run(dl_id)
    if ref is None:
        return running
    waiting = (db.PAUSED_STATUS,) if running else (db.PAUSED_STATUS, "queued")
    with db.conn() as c:
        cancelled = _set_run_error(c, ref, "cancelled", message(CANCELLED_BY_USER),
                                   from_statuses=waiting)
    return running or cancelled


def pause_download(dl_id: int) -> bool:
    """Hold a queued or downloading row until it is resumed: any task for it is
    stopped and its partial file discarded. The row is marked first, so the task
    winding down finds it paused and leaves it so. False when it wasn't active."""
    active = db.ACTIVE_STATUSES
    with db.conn() as c:
        row = c.execute(
            f"UPDATE downloads SET status='{db.PAUSED_STATUS}', progress=0, speed_mbs=0, "
            "error=NULL, error_key=NULL, error_params=NULL "
            f"WHERE id=? AND status IN ({db.placeholders(active)}) "
            "RETURNING channel_id, save_path", (dl_id, *active)).fetchone()
    if row is None:
        return False
    t = _task_registry.get(dl_id)
    if t and not t.done():
        t.cancel()   # it discards the partial file once it has stopped writing
    else:
        _remove_partial(row["save_path"])
    db.log("INFO", message("event.transfer_paused", file=os.path.basename(row["save_path"])),
           channel_id=row["channel_id"])
    return True


def delete_for_arr(ref: AttemptRef) -> None:
    """A SABnzbd delete of ``ref``. A finished row is only hidden from *arr
    history (never its files); a queued or downloading one is cancelled at once,
    so a Retry may follow before its task has wound down. An id from an earlier
    attempt changes nothing."""
    if hide_from_history(*ref) or not is_current_attempt(*ref):
        return
    cancel_download(ref.download_id)
    with db.conn() as c:
        _set_run_error(c, _current_run(ref.download_id), "cancelled", message(CANCELLED_BY_USER),
                       from_statuses=db.ACTIVE_STATUSES)


async def retry_download(dl_id: int) -> str | None:
    """A user's Retry: re-queue a stopped download as a new attempt. None when
    it was re-queued, else the i18n key of why not."""
    return await _requeue_by_hand(dl_id, db.STOPPED_STATUSES, NOT_REQUEUED)


async def resume_download(dl_id: int) -> str | None:
    """Re-queue a paused download, restarting the file from the beginning under the
    same download id. None when it was re-queued, else the i18n key of why not."""
    return await _requeue_by_hand(dl_id, (db.PAUSED_STATUS,), NOT_PAUSED)


async def _requeue_by_hand(dl_id: int, from_statuses: tuple, refused: str) -> str | None:
    """Re-queue a row in one of ``from_statuses`` with a full auto-retry budget.
    None when it was re-queued, else the i18n key of why not (``refused`` for a
    row in another status). The status is checked before Telegram is asked for
    the message, so this is a no-op on such a row even with Telegram down;
    ``requeue_stopped`` re-checks it, so racing requests can't reset a row that
    is already queued or downloading."""
    with db.conn() as c:
        row = c.execute("""SELECT d.*, c.chat_id FROM downloads d
                           JOIN channels c ON c.id=d.channel_id WHERE d.id=?""",
                        (dl_id,)).fetchone()
    if row is None or row["status"] not in from_statuses:
        return refused
    client = get_client()
    if not client.is_connected():
        await client.connect()
    msg = await client.get_messages(row["chat_id"], ids=row["message_id"])
    if not msg:
        return MESSAGE_GONE
    with db.conn() as c:
        if requeue_stopped(c, dl_id, RetryCount.RESET, from_statuses) is None:
            return refused
    spawn(_run_download(client, row["channel_id"], msg, row["save_path"], row["group_key"]))
    return None


async def enqueue(client, channel, msg, size, fn, gk, save_path):
    cid = channel["id"]
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
    spawn(_run_download(client, cid, msg, save_path, gk))


async def retry_failed(client, channel):
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
        except FloodWaitError as e:
            await downloader.flood_gate.trip(e.seconds)
            return
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
        spawn(_run_download(client, cid, msg, r["save_path"], r["group_key"]))


def _write_reason(c, status: str, reason: dict, where: str, args: tuple) -> bool:
    """Set the status and reason (stored as a key the UI translates) of the rows
    ``where`` matches; True if one changed."""
    text, key, params = db.keyed(reason)
    cur = c.execute("UPDATE downloads SET status=?, error=?, error_key=?, error_params=? "
                    f"WHERE {where}", (status, text, key, params, *args))
    return cur.rowcount > 0


def _set_error(c, dl_id: int, status: str, reason: dict) -> None:
    """Set a download's status and its reason, whatever run it is on."""
    _write_reason(c, status, reason, "id=?", (dl_id,))


def _set_run_error(c, ref: RunRef, status: str, reason: dict, *,
                   from_statuses: tuple = ()) -> bool:
    """:func:`_set_error` for one run only: a download task's writes must not land
    on a newer run that a retry or resume started. With ``from_statuses``, only
    while the row is in one of them. True if the row changed."""
    where = "id=? AND run=?"
    if from_statuses:
        where += f" AND status IN ({db.placeholders(from_statuses)})"
    return _write_reason(c, status, reason, where, (*ref, *from_statuses))


def _update_run(ref: RunRef, assignments: str, *values, from_statuses: tuple = ()) -> bool:
    """``UPDATE downloads SET <assignments>`` for one run of a row and, with
    ``from_statuses``, only while the row is in one of them. True if it changed."""
    where = "id=? AND run=?"
    if from_statuses:
        where += f" AND status IN ({db.placeholders(from_statuses)})"
    with db.conn() as c:
        cur = c.execute(f"UPDATE downloads SET {assignments} WHERE {where}",
                        (*values, *ref, *from_statuses))
    return cur.rowcount > 0


async def _wait_for_budget(ref: RunRef) -> None:
    """Hold a download (status queued, reason in `error`) until the daily budget allows it."""
    marked = False
    while safety.budget_exhausted():
        if not marked:
            resets = time.strftime("%H:%M", time.localtime(safety.budget_status()["resets_at"]))
            with db.conn() as c:
                _set_run_error(c, ref, "queued", message("budget.download_held", resets=resets))
            marked = True
        await asyncio.sleep(BUDGET_RECHECK_SECONDS)


def _remove_partial(save_path: str) -> None:
    with contextlib.suppress(OSError):
        os.remove(save_path + ".tmp")


class _Run(NamedTuple):
    """What one download task works on: a channel message's file, for one run of its row."""
    channel_id: int
    msg: Any
    save_path: str
    ref: RunRef


def _finish_if_on_disk(run: _Run, fsize: int) -> bool:
    """Mark the download complete when its file is already on disk.

    Covers a file fully downloaded but not finalized before a crash/restart, or
    grabbed by a sibling source; re-downloading it used to loop forever,
    re-writing a full .tmp and stalling at the finalize step."""
    path = run.save_path
    if not (fsize and os.path.exists(path) and os.path.getsize(path) >= fsize * ON_DISK_RATIO):
        return False
    _remove_partial(path)
    _update_run(run.ref, "status='completed', progress=1.0, speed_mbs=0, finished_at=?",
                int(time.time()))
    db.log("INFO", message("event.already_on_disk", file=os.path.basename(path)),
           channel_id=run.channel_id)
    return True


async def _fetch(client, run: _Run, fsize: int) -> bool:
    """Download the message's file to `save_path`, keeping the row's progress
    current. False when the row was stopped meanwhile and stays as it is: a
    paused row finds the file on disk when it is resumed."""
    _update_run(run.ref, "status='downloading', started_at=?, error=NULL, "
                "error_key=NULL, error_params=NULL", int(time.time()))

    async def progress(pct, speed):
        _update_run(run.ref, "progress=?, speed_mbs=?", pct, speed,
                    from_statuses=db.ACTIVE_STATUSES)

    await download_file(client, run.msg, run.save_path, progress_cb=progress)
    safety.record_download(fsize)
    return _update_run(run.ref, "status='completed', progress=1.0, finished_at=?",
                       int(time.time()), from_statuses=db.ACTIVE_STATUSES)


def _announce_completed(channel_id: int, save_path: str) -> None:
    """Log the finished file, prune history, refresh Plex and send the notification."""
    name = os.path.basename(save_path)
    db.log("INFO", message("event.downloaded", file=name), channel_id=channel_id)
    _prune_history(channel_id)
    with db.conn() as c:
        ch = c.execute("SELECT imdb_id, imdb_title, title FROM channels WHERE id=?", (channel_id,)).fetchone()
    show = (ch["imdb_title"] or ch["title"]) if ch else ""
    spawn(plex.refresh_path(os.path.dirname(save_path)))
    spawn(notify.send(translate("notify.downloaded"), name, imdb_id=(ch["imdb_id"] if ch else None), show=show))


def _on_cancelled(run: _Run) -> None:
    """Record why the task stopped. A paused row, or a newer run, keeps its
    state; the partial file goes unless the row will resume on the next boot."""
    if _shutting_down and _update_run(run.ref, "status='queued', progress=0, speed_mbs=0",
                                      from_statuses=db.ACTIVE_STATUSES):
        return   # process is stopping — leave it queued so it resumes on next boot
    with db.conn() as c:
        stopped = _set_run_error(c, run.ref, "cancelled", message(CANCELLED_BY_USER),
                                 from_statuses=(*db.ACTIVE_STATUSES, "cancelled"))
    _remove_partial(run.save_path)
    if stopped:
        db.log("WARN", message("event.cancelled", file=os.path.basename(run.save_path)),
               channel_id=run.channel_id)


def _on_failed(run: _Run, error: Exception) -> None:
    """Fail the row. One stopped meanwhile (the error came while winding down),
    or on a newer run, keeps its state, and the partial file goes."""
    with db.conn() as c:
        failed = _set_run_error(c, run.ref, "failed", message(DOWNLOAD_FAILED, error=str(error)),
                                from_statuses=db.ACTIVE_STATUSES)
    if not failed:
        _remove_partial(run.save_path)
        log.warning("download %s run %s: error while stopping: %s", *run.ref, error)
        return
    db.log("ERROR", message("event.download_failed", error=str(error)), channel_id=run.channel_id)


class _SlotHolder(NamedTuple):
    """The task holding an episode's in-flight slot, and the run it downloads."""
    ref: RunRef
    task: asyncio.Task


def _download_ref(channel_id: int, message_id: int) -> RunRef | None:
    with db.conn() as c:
        row = c.execute("SELECT id, run FROM downloads WHERE channel_id=? AND message_id=?",
                        (channel_id, message_id)).fetchone()
    return RunRef(row["id"], row["run"]) if row else None


def _current_run(dl_id: int) -> RunRef | None:
    with db.conn() as c:
        row = c.execute("SELECT id, run FROM downloads WHERE id=?", (dl_id,)).fetchone()
    return RunRef(row["id"], row["run"]) if row else None


def _still_wanted(ref: RunRef) -> bool:
    """True while the row is on run ``ref`` and not stopped or paused. A cancel or
    pause that finds no registered task only changes the row, so a task checks
    this before it starts and again once it holds the slot (it may have waited)."""
    with db.conn() as c:
        row = c.execute("SELECT status FROM downloads WHERE id=? AND run=?", (*ref,)).fetchone()
    return row is not None and row["status"] not in db.HALTED_STATUSES


def _supersedes(ref: RunRef, holder: RunRef) -> bool:
    """True when ``ref`` is a newer run of the row ``holder`` is downloading."""
    return ref.download_id == holder.download_id and ref.run > holder.run


def _resolve_inflight_loser(ref: RunRef, holder: RunRef) -> None:
    """A task lost the in-flight slot for its episode. A duplicate task for the
    row already downloading (or a stale one for an earlier run) changes
    nothing; a row for another message of the same episode is cancelled with a
    reason, so it isn't left queued with no task behind it (and isn't resumed
    into the same race after a restart)."""
    if ref.download_id == holder.download_id:
        return
    with db.conn() as c:   # only a row still waiting: a finished row keeps its outcome
        _set_run_error(c, ref, "cancelled", message(DUPLICATE_IN_FLIGHT),
                       from_statuses=("queued",))


def _fail_stalled_handoff(ref: RunRef, holder: RunRef) -> None:
    """The previous run's task never wound down: fail the new run with a reason
    rather than wait forever (a later retry may take over)."""
    log.warning("download %s run %s: run %s still holds the slot after %ss",
                ref.download_id, ref.run, holder.run, SLOT_HANDOFF_TIMEOUT_SECONDS)
    with db.conn() as c:
        _set_run_error(c, ref, "failed", message(STALLED_HANDOFF), from_statuses=("queued",))


async def _claim_slot(key, ref: RunRef) -> bool:
    """Take the in-flight slot for an episode; False when this task lost it. A
    newer run of the row holding the slot (a retry right after a cancel) waits
    for the older run's task to finish winding down, then claims it;
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
            register_task(ref.download_id, me)   # a cancel of the new run stops this task
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
    ref = _download_ref(channel_id, msg.id)   # every write below is scoped to this run
    if ref is None or not _still_wanted(ref):
        return   # deleted or cancelled before its task started
    if settings.get_bool("paused", False):
        _update_run(ref, "status='queued'")
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
            if await _fetch(client, run, fsize):
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


def queue_grab(client, channel_id, msg, size, fn, gk, save_path) -> AttemptRef | None:
    """Queue the file a Grab picked; returns the row's current attempt. A re-grab
    of a failed or cancelled row starts a new attempt."""
    with db.conn() as c:
        c.execute("""INSERT OR IGNORE INTO downloads
            (channel_id,message_id,group_key,file_name,file_size,save_path,status,created_at)
            VALUES(?,?,?,?,?,?,?,?)""",
            (channel_id, msg.id, gk, fn, size, save_path, "queued", int(time.time())))
        row = c.execute("SELECT id, status, attempt FROM downloads "
                        "WHERE channel_id=? AND message_id=?", (channel_id, msg.id)).fetchone()
        ref = None
        if row:
            stopped = row["status"] in db.STOPPED_STATUSES
            requeued = requeue_stopped(c, row["id"], RetryCount.KEEP) if stopped else None
            ref = AttemptRef(row["id"], row["attempt"] if requeued is None else requeued)
    db.log("INFO", message("event.grab_queued", file=fn), channel_id=channel_id)
    spawn(_run_download(client, channel_id, msg, save_path, gk))
    return ref


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
            spawn(_run_download(client, r["channel_id"], msg, r["save_path"], r["group_key"]))
        except Exception as e:
            db.log("ERROR", message("event.resume_failed", message_id=r["message_id"], error=str(e)))
