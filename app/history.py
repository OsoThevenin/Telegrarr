# app/history.py — the background history fetch: reads a source's older messages
# in throttled batches until its oldest message is reached.
#
# Each source keeps its cursor in the channels table's history_* columns, so the
# fetch survives a restart. A source's first finished scan starts it, and any
# later scan that could not reach the last message it knew starts it again, down
# to that message (the floor): that is what reads a gap left by a source whose
# scanning was off. The scan loop runs the batches, indexing them through the
# callback it passes in (the scanner owns indexing, and imports this module).
import time
from collections.abc import Awaitable, Callable, Sequence

from telethon.errors import FloodWaitError

from . import channels, db, downloader, safety, tg, topic_errors
from .i18n import message

BATCH_SIZE = 200          # messages one batch asks Telegram for

IndexMessages = Callable[[object, dict, Sequence], Awaitable[None]]   # client, channel, messages
MayRun = Callable[[dict], bool]


def note_scan(cid: int, read: tg.MessageRead, last: int, limit: int) -> None:
    """A scan of source `cid` finished, having read `read` with `limit` from the
    `last` message it knew. Filling its limit means it may not have reached that
    message: what lies below goes to the batches, however it got there."""
    now = int(time.time())
    with db.conn() as c:
        c.execute("""UPDATE channels SET history_read=history_read+?, history_total=COALESCE(?, history_total)
                     WHERE id=?""", (read.count, read.total, cid))
        if read.count >= limit:
            c.execute("""UPDATE channels SET history_oldest_id=?, history_complete=0,
                           history_floor=CASE history_complete WHEN 1 THEN ? ELSE history_floor END,
                           history_next_at=COALESCE(history_next_at, ?)
                         WHERE id=?""", (read.oldest_id, last, now, cid))
        else:
            c.execute("""UPDATE channels SET history_oldest_id=?, history_complete=?, history_next_at=?
                         WHERE id=? AND history_next_at IS NULL""",
                      (read.oldest_id, int(not last), now, cid))


def request(cid: int) -> None:
    """The operator asked for source `cid`'s whole history. It goes through the
    batches like any other, so asking again never brings a batch forward; a
    history that was finished is read again from the newest message."""
    with db.conn() as c:
        c.execute("""UPDATE channels SET history_requested=1, history_floor=0,
                       history_next_at=COALESCE(history_next_at, ?),
                       history_oldest_id=CASE history_complete WHEN 1 THEN 0 ELSE history_oldest_id END,
                       history_read=CASE history_complete WHEN 1 THEN 0 ELSE history_read END,
                       history_complete=0
                     WHERE id=?""", (int(time.time()), cid))


def _due(now: float) -> list[dict]:
    """The sources whose next batch is due, the most overdue first. The operator's
    request reaches a disabled source too, and goes on whatever its weekdays."""
    with db.conn() as c:
        return [dict(r) for r in c.execute(
            """SELECT * FROM channels
               WHERE scanning=1 AND history_complete=0 AND history_next_at<=?
                 AND (enabled=1 OR history_requested=1)
               ORDER BY history_next_at""", (now,))]


def _advance(channel: dict, read: tg.MessageRead) -> None:
    """Move the source's cursor past a batch that was read and indexed; running
    out of messages finishes its history. A scan or a request that changed the
    walk while the batch ran wins: the batch's messages stay indexed, nothing else."""
    complete = read.count < BATCH_SIZE
    with db.conn() as c:
        moved = c.execute(
            """UPDATE channels SET history_oldest_id=?, history_read=history_read+?,
                 history_total=COALESCE(?, history_total), history_complete=?,
                 history_requested=history_requested AND ?
               WHERE id=? AND history_oldest_id=? AND history_floor=?""",
            (read.oldest_id or channel["history_oldest_id"], read.count, read.total,
             int(complete), int(not complete), channel["id"],
             channel["history_oldest_id"], channel["history_floor"])).rowcount
    if moved and complete:
        _log_finished(channel)


def _log_finished(channel: dict) -> None:
    cid = channel["id"]
    db.log("INFO", message("event.backfill_done", channel=topic_errors.source_label(channel),
                           messages=channels.get(cid)["history_read"]), channel_id=cid)


async def _read_batch(client, channel: dict, index: IndexMessages, now: float) -> None:
    """Read and index the source's next batch. The next one is scheduled first, so
    a failing source waits its turn; the cursor stays until the batch is indexed."""
    cid = channel["id"]
    with db.conn() as c:
        c.execute("UPDATE channels SET history_next_at=? WHERE id=?",
                  (safety.next_history_batch(now), cid))
    try:
        read = await tg.read_messages(client, channel["chat_id"], limit=BATCH_SIZE,
                                      topic_id=channel["topic_id"],
                                      offset_id=channel["history_oldest_id"],
                                      min_id=channel["history_floor"])
        await index(client, channel, read.messages)
    except FloodWaitError as e:
        await downloader.flood_gate.trip(e.seconds)
    except Exception as e:
        reason = topic_errors.unreadable_topic(channel, e)
        db.log("ERROR", reason or message("event.scan_failed", channel=channel["title"], error=str(e)),
               channel_id=cid)
    else:
        _advance(channel, read)


async def run_due(client, index: IndexMessages, may_run: MayRun) -> None:
    """Read one batch, of the most overdue source `may_run` lets through, unless
    the flood gate is closed or the daily budget is spent."""
    if downloader.flood_gate.minutes_closed() or safety.budget_exhausted():
        return
    now = time.time()
    channel = next((ch for ch in _due(now) if ch["history_requested"] or may_run(ch)), None)
    if channel is not None:
        await _read_batch(client, channel, index, now)
