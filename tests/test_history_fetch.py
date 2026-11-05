"""History fetch: Telegrarr reads a channel's older messages by itself, in small
throttled batches, until the channel's oldest message is reached.

Driven over HTTP (``arr_app``) with the real scan loop (``history_loop``) and
Telegram faked at the client; assertions look at what Telegram was asked for
and at what Sonarr/Radarr are offered.
"""
import asyncio
import datetime
import time

import pytest

from app import db, downloader, scanner, transfers
from app.main import app, lifespan
from app.safety import FloodGate
from fake_tmdb import API_KEY
from http_harness import GENERAL_TOPIC_ID, GENERAL_TOPIC_TITLE, eventually

CHAT = -1007600000001
OTHER_CHAT = -1007600000002
SHOW = "The Show"
OTHER_SHOW = "Other Show"
TOPIC = "Sèries HD"
SIBLING_TOPIC = "Novetats"
FORUM_PREAMBLE = 3       # ids taken by a forum's creation and its two topics
BATCH = 200              # messages one history batch asks Telegram for
FIRST_SCAN = 80          # newest messages a scan reads
LONG = 450               # one first scan and two batches: 80 + 200 + 170
SHORT = 30               # read whole by a first scan
SEEN = 10                # messages a source had when its scanning was turned off
MISSED = 300             # messages posted meanwhile: more than a scan reads
AFTER_SCAN = LONG - FIRST_SCAN + 1          # where the first batch starts
AFTER_BATCH = AFTER_SCAN - BATCH            # where the second batch starts
ONE_FILE_BUDGET_GB = 0.0000005              # ~537 bytes: one grab uses it up
FLOOD_S = 600
SOME_TICKS_S = 0.1
TMDB_SERIES = 1399
TVDB_SERIES = 121361


def _batches(tg, chat_id=CHAT):
    return [r for r in tg.reads if r.chat_id == chat_id and r.limit == BATCH]


async def _long_source(arr_app, episodes=LONG, chat_id=CHAT, title=SHOW):
    """A series channel of ``episodes`` messages, added but not read yet."""
    arr_app.telegram.add_channel(chat_id, title)
    arr_app.post_episodes(chat_id, title, range(1, episodes + 1))
    return await arr_app.add_channel(chat_id)


async def _scanned_source(arr_app, episodes=LONG):
    """A long source whose first scan finished: its history is due."""
    source = await _long_source(arr_app, episodes)
    await arr_app.scan(source["id"])
    return source


def _offered(arr_app, *episodes, show=SHOW):
    """Wait until Newznab offers all of ``episodes``."""
    async def probe():
        return all([await arr_app.offers_episode(show, ep) for ep in episodes])
    return eventually(probe)


def _whole_history_offered(arr_app):
    """The first scan's window, each batch's, and the channel's oldest message."""
    return _offered(arr_app, LONG, AFTER_SCAN - 1, AFTER_BATCH - 1, 1)


def _batch_read(tg, count=1, chat_id=CHAT):
    async def probe():
        return len(_batches(tg, chat_id)) >= count
    return eventually(probe)


def _polled_again(tg, chat_id=CHAT, times=5):
    """Wait until the loop has gone round ``times`` more times, reading ``chat_id``."""
    seen = tg.reads_of(chat_id)

    async def probe():
        return tg.reads_of(chat_id) >= seen + times
    return eventually(probe)


def _forum(tg):
    return tg.add_forum(CHAT, SHOW, topics=(TOPIC, SIBLING_TOPIC))


def _topic_source(arr_app, forum, title):
    return arr_app.add_channel(CHAT, kind="tv", topic_id=forum.topic_id(title), topic_title=title)


async def _channel_row(arr_app, source):
    rows = (await arr_app.http.get("/api/channels")).raise_for_status().json()
    return next(c for c in rows if c["id"] == source["id"])


async def _progress(arr_app, source):
    return (await _channel_row(arr_app, source))["history"]


async def _rescan(arr_app, source, newest):
    """Scan a source again, and wait until the scan got through to message ``newest``."""
    (await arr_app.http.post(f"/api/channels/{source['id']}/scan")).raise_for_status()

    async def probe():
        return (await _channel_row(arr_app, source))["last_message_id"] == newest
    await eventually(probe)


async def _set_scanning(arr_app, source, on):
    r = await arr_app.http.patch(f"/api/channels/{source['id']}", json={"scanning": on})
    r.raise_for_status()


async def _downloads(arr_app):
    """How many rows the transfers list holds."""
    return len((await arr_app.http.get("/api/downloads")).raise_for_status().json())


async def _recover_history(arr_app, source):
    (await arr_app.http.post(f"/api/channels/{source['id']}/backfill")).raise_for_status()


async def _history_finished(arr_app, source):
    """Wait for the event that says the source's whole history was read; returns it."""
    async def probe():
        logs = (await arr_app.http.get("/api/logs", params={"channel_id": source["id"]})).json()
        return next((row for row in logs if (row["msg"] or {}).get("key") == "event.backfill_done"), None)
    return await eventually(probe)


async def _set_budget(arr_app, gb):
    (await arr_app.http.patch("/api/settings", json={"daily_budget_gb": gb})).raise_for_status()


@pytest.mark.asyncio
async def test_a_channel_longer_than_a_batch_is_read_to_its_oldest_message(arr_app, history_loop):
    await _long_source(arr_app)

    async with history_loop():
        await _whole_history_offered(arr_app)

    batches = _batches(arr_app.telegram)
    assert [b.offset_id for b in batches] == [AFTER_SCAN, AFTER_BATCH]


@pytest.mark.asyncio
async def test_a_second_batch_waits_for_the_interval(arr_app, polling):
    await _long_source(arr_app)

    async with polling():
        await _batch_read(arr_app.telegram)
        await _polled_again(arr_app.telegram)

    assert len(_batches(arr_app.telegram)) == 1


@pytest.mark.asyncio
async def test_two_sources_due_at_once_do_not_read_in_the_same_tick(arr_app, polling):
    tg = arr_app.telegram
    await _long_source(arr_app)
    await _long_source(arr_app, chat_id=OTHER_CHAT, title=OTHER_SHOW)

    async with polling():
        await _batch_read(tg, chat_id=CHAT)
        await _batch_read(tg, chat_id=OTHER_CHAT)

    positions = [i for i, r in enumerate(tg.reads) if r.limit == BATCH]
    assert len(positions) == 2
    assert positions[1] - positions[0] > 1      # polls of a later tick came between them


@pytest.mark.asyncio
async def test_no_batch_runs_while_the_queue_is_paused(arr_app, batches_only):
    await _scanned_source(arr_app)
    (await arr_app.http.post("/api/queue/pause")).raise_for_status()

    async with batches_only():
        await asyncio.sleep(SOME_TICKS_S)
        while_paused = len(_batches(arr_app.telegram))
        (await arr_app.http.post("/api/queue/resume")).raise_for_status()
        await _whole_history_offered(arr_app)

    assert while_paused == 0


@pytest.mark.asyncio
async def test_no_batch_runs_while_the_daily_budget_is_spent(arr_app, batches_only):
    await _scanned_source(arr_app)
    await _set_budget(arr_app, ONE_FILE_BUDGET_GB)
    await arr_app.history_slot(await arr_app.grab(await arr_app.episode_url(SHOW, LONG)))

    async with batches_only():
        await asyncio.sleep(SOME_TICKS_S)
        while_spent = len(_batches(arr_app.telegram))
        await _set_budget(arr_app, 0)
        await _whole_history_offered(arr_app)

    assert while_spent == 0


@pytest.mark.asyncio
async def test_a_flood_wait_holds_batches_and_the_same_batch_is_read_again(
        arr_app, batches_only, monkeypatch):
    tg = arr_app.telegram
    now = [1_000_000.0]
    monkeypatch.setattr(downloader, "flood_gate", FloodGate(clock=lambda: now[0]))
    await _scanned_source(arr_app)
    tg.flood_seconds, tg.flood_on_next_read = FLOOD_S, True

    async with batches_only():
        await _batch_read(tg)
        await asyncio.sleep(SOME_TICKS_S)
        while_closed = len(_batches(tg))
        now[0] += FLOOD_S + 1
        await _whole_history_offered(arr_app)

    assert while_closed == 1
    assert [b.offset_id for b in _batches(tg)] == [AFTER_SCAN, AFTER_SCAN, AFTER_BATCH]


@pytest.mark.asyncio
async def test_a_source_with_scanning_off_gets_no_batches_and_resumes_where_it_stopped(
        arr_app, batches_only):
    tg = arr_app.telegram
    source = await _scanned_source(arr_app)
    tg.hold_history()

    async with batches_only():
        await _batch_read(tg)                       # the first batch is under way
        await _set_scanning(arr_app, source, False)
        tg.release_history()
        await _offered(arr_app, AFTER_BATCH)        # it finishes indexing
        await asyncio.sleep(SOME_TICKS_S)
        while_off = len(_batches(tg))
        await _set_scanning(arr_app, source, True)
        await _whole_history_offered(arr_app)

    assert while_off == 1
    assert [b.offset_id for b in _batches(tg)] == [AFTER_SCAN, AFTER_BATCH]


@pytest.mark.asyncio
async def test_a_channel_a_first_scan_reads_whole_gets_no_batches(arr_app, polling):
    await _long_source(arr_app, episodes=SHORT)

    async with polling():
        await _offered(arr_app, 1)
        await _polled_again(arr_app.telegram)

    assert _batches(arr_app.telegram) == []


@pytest.mark.asyncio
async def test_nothing_is_read_before_the_first_scan_finishes(arr_app, batches_only):
    await _long_source(arr_app)

    async with batches_only():
        await asyncio.sleep(SOME_TICKS_S)

    assert arr_app.telegram.reads == []


@pytest.mark.asyncio
async def test_a_history_ending_on_a_batch_boundary_stops_at_the_empty_read(arr_app, batches_only):
    source = await _scanned_source(arr_app, episodes=FIRST_SCAN + BATCH)

    async with batches_only():
        await _history_finished(arr_app, source)
        await asyncio.sleep(SOME_TICKS_S)

    assert [b.offset_id for b in _batches(arr_app.telegram)] == [BATCH + 1, 1]


@pytest.mark.asyncio
async def test_the_event_log_says_a_history_finished(arr_app, batches_only):
    source = await _scanned_source(arr_app)

    async with batches_only():
        row = await _history_finished(arr_app, source)

    assert row["msg"]["params"] == {"channel": SHOW, "messages": LONG}


@pytest.mark.asyncio
async def test_a_failing_read_is_logged_and_retried_from_the_same_cursor(arr_app, batches_only):
    tg = arr_app.telegram
    source = await _scanned_source(arr_app)
    tg.fail_next_read = True

    async with batches_only():
        await _whole_history_offered(arr_app)

    logs = (await arr_app.http.get("/api/logs", params={"channel_id": source["id"]})).json()
    assert [row["msg"]["key"] for row in logs if row["level"] == "ERROR"] == ["event.scan_failed"]
    assert [b.offset_id for b in _batches(tg)] == [AFTER_SCAN, AFTER_SCAN, AFTER_BATCH]


@pytest.mark.asyncio
async def test_recovering_a_history_reads_it_in_batches(arr_app, batches_only):
    tg = arr_app.telegram
    source = await _long_source(arr_app)

    await _recover_history(arr_app, source)
    async with batches_only():
        await _history_finished(arr_app, source)

    assert await arr_app.offers_episode(SHOW, 1)
    assert [(r.limit, r.offset_id) for r in tg.reads] == [
        (BATCH, 0), (BATCH, LONG - BATCH + 1), (BATCH, LONG - 2 * BATCH + 1)]


@pytest.mark.asyncio
async def test_pressing_recover_again_does_not_shorten_the_wait(arr_app, polling):
    tg = arr_app.telegram
    source = await _long_source(arr_app)

    async with polling():
        await _batch_read(tg)
        await _recover_history(arr_app, source)
        await _recover_history(arr_app, source)
        await _polled_again(tg)

    assert len(_batches(tg)) == 1


@pytest.mark.asyncio
async def test_recovering_a_finished_history_reads_it_again_from_the_newest(arr_app, batches_only):
    source = await _scanned_source(arr_app, episodes=SHORT)    # finished by its first scan

    await _recover_history(arr_app, source)
    async with batches_only():
        await _history_finished(arr_app, source)

    assert [b.offset_id for b in _batches(arr_app.telegram)] == [0]


@pytest.mark.asyncio
async def test_a_disabled_source_gets_no_batches_until_its_history_is_recovered(arr_app, batches_only):
    source = await _scanned_source(arr_app)
    r = await arr_app.http.patch(f"/api/channels/{source['id']}", json={"enabled": False})
    r.raise_for_status()

    async with batches_only():
        await asyncio.sleep(SOME_TICKS_S)
        while_disabled = len(_batches(arr_app.telegram))
        await _recover_history(arr_app, source)
        await _history_finished(arr_app, source)

    assert while_disabled == 0


@pytest.mark.asyncio
async def test_batches_keep_to_the_weekdays_of_the_source_unless_recovered(arr_app, batches_only):
    tomorrow = (datetime.datetime.now().weekday() + 1) % 7
    source = await _scanned_source(arr_app)
    r = await arr_app.http.patch(f"/api/channels/{source['id']}", json={"weekdays": str(tomorrow)})
    r.raise_for_status()

    async with batches_only():
        await asyncio.sleep(SOME_TICKS_S)
        off_day = len(_batches(arr_app.telegram))
        await _recover_history(arr_app, source)
        await _history_finished(arr_app, source)

    assert off_day == 0


@pytest.mark.asyncio
async def test_in_standalone_mode_only_a_recovered_history_queues_what_it_finds(arr_app, batches_only):
    tg = arr_app.telegram
    patched = await arr_app.http.patch("/api/settings", json={"operating_mode": "standalone"})
    patched.raise_for_status()
    source = await _long_source(arr_app, episodes=1)
    for n in range(FIRST_SCAN):                 # newer chatter, so the first scan finds no file
        tg.post_text(CHAT, f"chatter {n}")
    await arr_app.scan(source["id"])

    async with batches_only():
        await _offered(arr_app, 1)              # the walk indexed the old episode
        await asyncio.sleep(SOME_TICKS_S)
        after_walk = await _downloads(arr_app)
        await _recover_history(arr_app, source)

        async def queued():
            return await _downloads(arr_app) == 1
        await eventually(queued)

    assert after_walk == 0


@pytest.mark.asyncio
async def test_what_a_scan_cannot_reach_after_scanning_was_off_is_read_in_batches(arr_app, history_loop):
    tg = arr_app.telegram
    source = await _scanned_source(arr_app, episodes=SEEN)      # finished by its first scan
    await _set_scanning(arr_app, source, False)
    arr_app.post_episodes(CHAT, SHOW, range(SEEN + 1, SEEN + MISSED + 1))
    await _set_scanning(arr_app, source, True)

    async with history_loop():
        await _offered(arr_app, SEEN + 1, 100, 230, SEEN + MISSED)
        await _history_finished(arr_app, source)

    batches = _batches(tg)
    assert [b.offset_id for b in batches] == [231, 31]
    assert {b.min_id for b in batches} == {SEEN}                # nothing already read is read again


@pytest.mark.asyncio
async def test_a_gap_during_an_unfinished_history_is_read_on_the_way_down(arr_app, history_loop):
    tg = arr_app.telegram
    await _scanned_source(arr_app)
    arr_app.post_episodes(CHAT, SHOW, range(LONG + 1, LONG + MISSED + 1))

    async with history_loop():
        await _offered(arr_app, 1, 400, 600, LONG + MISSED)

    assert [b.offset_id for b in _batches(tg)] == [671, 471, 271, 71]


@pytest.mark.asyncio
async def test_a_batch_finishing_after_a_scan_reopened_the_walk_leaves_the_new_cursor(arr_app, batches_only):
    tg = arr_app.telegram
    source = await _scanned_source(arr_app)
    arr_app.post_episodes(CHAT, SHOW, range(LONG + 1, LONG + MISSED + 1))
    tg.hold_history(limit=BATCH)

    async with batches_only():
        await _batch_read(tg)                   # in flight, at the old cursor
        await _rescan(arr_app, source, LONG + MISSED)
        tg.release_history()
        await _offered(arr_app, 1, 500, LONG + MISSED)


@pytest.mark.asyncio
async def test_recovering_during_a_gap_walk_goes_on_to_the_oldest_message(arr_app, batches_only):
    tg = arr_app.telegram
    source = await _scanned_source(arr_app, episodes=SEEN)
    arr_app.post_episodes(CHAT, SHOW, range(SEEN + 1, SEEN + FIRST_SCAN + SHORT + 1))
    await _rescan(arr_app, source, SEEN + FIRST_SCAN + SHORT)
    tg.hold_history()

    async with batches_only():
        await _batch_read(tg)                   # this one would have finished the gap
        await _recover_history(arr_app, source)
        tg.release_history()
        await _history_finished(arr_app, source)

    assert [b.min_id for b in _batches(tg)] == [SEEN, 0]
    assert await arr_app.offers_episode(SHOW, 1)


@pytest.mark.asyncio
async def test_a_topic_is_read_to_its_oldest_message_without_its_siblings(arr_app, batches_only):
    tg = arr_app.telegram
    forum = _forum(tg)
    arr_app.post_episodes(CHAT, SHOW, [LONG + 1], topic=forum.topic_id(SIBLING_TOPIC))
    arr_app.post_episodes(CHAT, SHOW, range(1, LONG + 1), topic=forum.topic_id(TOPIC))
    source = await _topic_source(arr_app, forum, TOPIC)
    await arr_app.scan(source["id"])

    async with batches_only():
        await _history_finished(arr_app, source)

    assert await arr_app.offers_episode(SHOW, 1)
    assert not await arr_app.offers_episode(SHOW, LONG + 1)
    first_scan_past_the_sibling = AFTER_SCAN + FORUM_PREAMBLE + 1
    assert [(b.topic, b.offset_id) for b in _batches(tg)] == [
        (forum.topic_id(TOPIC), first_scan_past_the_sibling),
        (forum.topic_id(TOPIC), first_scan_past_the_sibling - BATCH)]


@pytest.mark.asyncio
async def test_two_topics_of_one_chat_each_keep_their_own_cursor(arr_app, batches_only):
    tg = arr_app.telegram
    forum = _forum(tg)
    arr_app.post_episodes(CHAT, SHOW, range(1, LONG + 1), topic=forum.topic_id(TOPIC))
    arr_app.post_episodes(CHAT, SHOW, range(LONG + 1, 2 * LONG + 1), topic=forum.topic_id(SIBLING_TOPIC))
    for title in (TOPIC, SIBLING_TOPIC):
        await arr_app.scan((await _topic_source(arr_app, forum, title))["id"])

    async with batches_only():
        await _offered(arr_app, 1, LONG + 1)

    def cursors(title):
        return [b.offset_id for b in _batches(tg) if b.topic == forum.topic_id(title)]
    assert cursors(TOPIC) == [AFTER_SCAN + FORUM_PREAMBLE, AFTER_BATCH + FORUM_PREAMBLE]
    assert cursors(SIBLING_TOPIC) == [AFTER_SCAN + FORUM_PREAMBLE + LONG, AFTER_BATCH + FORUM_PREAMBLE + LONG]


@pytest.mark.asyncio
async def test_a_general_source_goes_on_through_whole_batches_of_named_topic_messages(arr_app, batches_only):
    tg = arr_app.telegram
    forum = _forum(tg)
    arr_app.post_episodes(CHAT, SHOW, range(1, SHORT + 1))      # General's, the oldest in the group
    in_a_topic = SHORT + 1
    arr_app.post_episodes(CHAT, SHOW, range(in_a_topic, in_a_topic + FIRST_SCAN + BATCH), topic=forum.topic_id(TOPIC))
    source = await arr_app.add_channel(CHAT, kind="tv", topic_id=GENERAL_TOPIC_ID,
                                       topic_title=GENERAL_TOPIC_TITLE)
    await arr_app.scan(source["id"])

    async with batches_only():
        await _offered(arr_app, 1, SHORT)

    assert not await arr_app.offers_episode(SHOW, in_a_topic)


@pytest.mark.asyncio
async def test_a_first_scan_that_failed_starts_no_history(arr_app, batches_only):
    tg = arr_app.telegram
    forum = _forum(tg)
    arr_app.post_episodes(CHAT, SHOW, range(1, LONG + 1), topic=forum.topic_id(TOPIC))
    source = await _topic_source(arr_app, forum, TOPIC)
    tg.delete_topic(CHAT, forum.topic_id(TOPIC))
    await arr_app.scan(source["id"])

    async with batches_only():
        await asyncio.sleep(SOME_TICKS_S)

    assert _batches(tg) == []


@pytest.mark.asyncio
async def test_a_restart_in_the_middle_of_a_batch_resumes_from_the_stored_cursor(arr_app, batches_only, monkeypatch):
    tg = arr_app.telegram
    await _scanned_source(arr_app)
    tg.hold_history(limit=BATCH, after=1)

    async with batches_only():
        await _batch_read(tg, 2)                # the app goes down in the middle of this one
    tg.release_history()
    monkeypatch.setattr(transfers, "_shutting_down", False)

    async with lifespan(app):
        await _whole_history_offered(arr_app)
        scanner._active.cancel()

    assert [b.offset_id for b in _batches(tg)] == [AFTER_SCAN, AFTER_BATCH, AFTER_BATCH]


@pytest.mark.asyncio
async def test_a_source_scanned_before_the_history_fetch_existed_starts_at_its_next_poll(arr_app, history_loop):
    tg = arr_app.telegram
    source = await _long_source(arr_app)
    with db.conn() as c:                        # as the last version left it: no history columns set
        c.execute("UPDATE channels SET last_message_id=?, last_scanned_at=? WHERE id=?",
                  (LONG, int(time.time()), source["id"]))

    async with history_loop():
        await _offered(arr_app, 1, LONG)
        await _history_finished(arr_app, source)

    assert {b.min_id for b in _batches(tg)} == {0}


@pytest.mark.asyncio
async def test_a_source_nothing_was_read_from_reports_no_progress(arr_app):
    source = await _long_source(arr_app)

    assert await _progress(arr_app, source) == {
        "read": 0, "total_estimate": None, "complete": False, "next_batch_at": None}


@pytest.mark.asyncio
async def test_progress_advances_as_batches_complete(arr_app, polling):
    source = await _long_source(arr_app)

    async def one_batch_counted():
        progress = await _progress(arr_app, source)
        return progress if progress["read"] == FIRST_SCAN + BATCH else None

    async with polling():
        progress = await eventually(one_batch_counted)

    assert progress["total_estimate"] == LONG
    assert progress["complete"] is False
    assert progress["next_batch_at"] > time.time()


@pytest.mark.asyncio
async def test_a_finished_history_shows_complete_with_no_next_batch(arr_app, batches_only):
    source = await _scanned_source(arr_app)

    async with batches_only():
        await _history_finished(arr_app, source)

    assert await _progress(arr_app, source) == {
        "read": LONG, "total_estimate": LONG, "complete": True, "next_batch_at": None}


@pytest.mark.asyncio
async def test_progress_is_the_same_after_a_restart(arr_app, polling, monkeypatch):
    source = await _long_source(arr_app)

    async def one_batch_counted():
        progress = await _progress(arr_app, source)
        return progress if progress["read"] == FIRST_SCAN + BATCH else None

    async with polling():
        before = await eventually(one_batch_counted)
    monkeypatch.setattr(transfers, "_shutting_down", False)

    async with lifespan(app):
        after = await _progress(arr_app, source)
        scanner._active.cancel()

    assert after == before


@pytest.mark.asyncio
@pytest.mark.parametrize("reported", [None, 0])
async def test_the_estimate_is_absent_when_telegram_gives_no_count(arr_app, batches_only, reported):
    arr_app.telegram.count_reported = lambda _count: reported
    source = await _scanned_source(arr_app)

    async with batches_only():
        await _history_finished(arr_app, source)

    assert await _progress(arr_app, source) == {
        "read": LONG, "total_estimate": None, "complete": True, "next_batch_at": None}


@pytest.mark.asyncio
async def test_an_empty_last_read_keeps_the_estimate_telegram_gave_before(arr_app, batches_only):
    tg = arr_app.telegram
    source = await _scanned_source(arr_app, episodes=FIRST_SCAN + BATCH)
    tg.count_reported = lambda _count: 0        # what an empty chunk says

    async with batches_only():
        await _history_finished(arr_app, source)

    assert (await _progress(arr_app, source))["total_estimate"] == FIRST_SCAN + BATCH


@pytest.mark.asyncio
async def test_messages_read_twice_after_a_gap_never_pass_the_estimate(arr_app, batches_only):
    source = await _scanned_source(arr_app)
    arr_app.post_episodes(CHAT, SHOW, range(LONG + 1, LONG + MISSED + 1))
    await _rescan(arr_app, source, LONG + MISSED)

    async with batches_only():
        await _history_finished(arr_app, source)

    assert await _progress(arr_app, source) == {
        "read": LONG + MISSED, "total_estimate": LONG + MISSED,
        "complete": True, "next_batch_at": None}


@pytest.mark.asyncio
async def test_a_source_with_scanning_off_has_no_next_batch(arr_app):
    source = await _scanned_source(arr_app)

    await _set_scanning(arr_app, source, False)

    assert (await _progress(arr_app, source))["next_batch_at"] is None


@pytest.mark.asyncio
async def test_a_disabled_source_has_no_next_batch_until_its_history_is_recovered(arr_app):
    source = await _scanned_source(arr_app)
    r = await arr_app.http.patch(f"/api/channels/{source['id']}", json={"enabled": False})
    r.raise_for_status()
    while_disabled = (await _progress(arr_app, source))["next_batch_at"]

    await _recover_history(arr_app, source)

    assert while_disabled is None
    assert (await _progress(arr_app, source))["next_batch_at"] is not None


@pytest.mark.asyncio
async def test_the_channels_api_keeps_the_history_cursor_to_itself(arr_app, fake_tmdb):
    fake_tmdb.add_series(TMDB_SERIES, titles={"en-US": SHOW}, tvdb_id=TVDB_SERIES)
    (await arr_app.http.patch("/api/settings", json={"tmdb_key": API_KEY})).raise_for_status()
    added = await _scanned_source(arr_app)
    patched = await arr_app.http.patch(f"/api/channels/{added['id']}", json={"poll_minutes": 30})
    mapped = await arr_app.http.put(f"/api/channels/{added['id']}/series", json={"tmdb_id": TMDB_SERIES})

    for row in (added, patched.raise_for_status().json(), mapped.raise_for_status().json(),
                await _channel_row(arr_app, added)):
        assert "history" in row
        assert [key for key in row if key.startswith("history_")] == []
