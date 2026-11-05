"""Scanning toggle: a source with scanning off costs no Telegram reads, while its
Releases stay offered and Grabs of them keep transferring.

Driven over HTTP (``arr_app``) with Telegram faked at the client (``FakeTelegram``).
"""
import asyncio
import xml.etree.ElementTree as ET

import pytest

from http_harness import eventually

CHAT = -1007500000001
OTHER_CHAT = -1007500000002
SHOW = "The Show"
FILE = "The.Show.S01E01.mkv"


async def _status(arr_app, file_name, status):
    row = await arr_app.download(file_name)
    return row if row and row["status"] == status else None


async def _channel(arr_app, cid):
    rows = (await arr_app.http.get("/api/channels")).raise_for_status().json()
    return next(c for c in rows if c["id"] == cid)


async def _set_scanning(arr_app, cid, on):
    return await arr_app.http.patch(f"/api/channels/{cid}", json={"scanning": on})


def _source(arr_app, chat_id=CHAT, title=SHOW):
    arr_app.telegram.add_channel(chat_id, title)
    return arr_app.add_channel(chat_id)


@pytest.mark.asyncio
async def test_a_new_source_has_scanning_on(arr_app):
    source = await _source(arr_app)

    assert (await _channel(arr_app, source["id"]))["scanning"] == 1


@pytest.mark.asyncio
async def test_the_operator_can_turn_scanning_off_and_back_on(arr_app):
    source = await _source(arr_app)

    off = await _set_scanning(arr_app, source["id"], False)
    assert off.status_code == 200
    assert (await _channel(arr_app, source["id"]))["scanning"] == 0

    (await _set_scanning(arr_app, source["id"], True)).raise_for_status()
    assert (await _channel(arr_app, source["id"]))["scanning"] == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("value", ["off", None, 2, 1, 0, 1.0, 0.0, [], {}])
async def test_a_scanning_value_that_is_no_switch_is_refused(arr_app, value):
    source = await _source(arr_app)

    r = await _set_scanning(arr_app, source["id"], value)

    assert r.status_code == 400
    assert r.json()["detail"]["key"] == "err.channel.choice"
    assert (await _channel(arr_app, source["id"]))["scanning"] == 1


async def _quiet_source(arr_app):
    """A scanned series source with a Release, with scanning now off and its
    Telegram reads so far counted; returns (source, reads so far)."""
    tg = arr_app.telegram
    tg.add_channel(CHAT, SHOW)
    arr_app.post_episodes(CHAT, SHOW, [1])
    source = await arr_app.add_channel(CHAT)
    await arr_app.scan(source["id"])
    (await _set_scanning(arr_app, source["id"], False)).raise_for_status()
    return source, tg.reads_of(CHAT)


@pytest.mark.asyncio
@pytest.mark.parametrize("action", ["scan", "backfill"])
async def test_a_manual_read_is_refused_while_scanning_is_off(arr_app, action):
    source, reads = await _quiet_source(arr_app)

    r = await arr_app.http.post(f"/api/channels/{source['id']}/{action}")
    await asyncio.sleep(0)   # a spawned read would start here

    assert r.status_code == 409
    assert r.json()["detail"]["key"] == "err.channel.scanning_off"
    assert arr_app.telegram.reads_of(CHAT) == reads


@pytest.mark.asyncio
@pytest.mark.parametrize("action", ["scan", "backfill"])
async def test_a_manual_read_of_an_unknown_source_is_still_not_found(arr_app, action):
    r = await arr_app.http.post(f"/api/channels/4242/{action}")

    assert r.status_code == 404


@pytest.mark.asyncio
async def test_a_manual_scan_works_again_once_scanning_is_back_on(arr_app):
    source, _ = await _quiet_source(arr_app)
    arr_app.post_episodes(CHAT, SHOW, [2])
    (await _set_scanning(arr_app, source["id"], True)).raise_for_status()

    await arr_app.scan(source["id"])

    assert await arr_app.episode_url(SHOW, 2)


@pytest.mark.asyncio
async def test_scan_all_skips_a_source_with_scanning_off(arr_app):
    source, reads = await _quiet_source(arr_app)
    other = await _source(arr_app, OTHER_CHAT, "Other")

    r = await arr_app.http.post("/api/system/tasks/scan_all")

    await arr_app.scan(other["id"])   # waits for the started scan to have run
    assert r.json()["message"]["params"]["n"] == 1
    assert OTHER_CHAT in arr_app.telegram.history_reads
    assert arr_app.telegram.reads_of(CHAT) == reads
    assert (await _channel(arr_app, source["id"]))["scanning"] == 0


@pytest.mark.asyncio
async def test_the_scheduled_tasks_promise_no_next_run_while_scanning_is_off(arr_app):
    source, _ = await _quiet_source(arr_app)

    tasks = (await arr_app.http.get("/api/system/tasks")).raise_for_status().json()
    [task] = [t for t in tasks if t["channel_id"] == source["id"]]

    assert task["next_run"] is None
    assert task["enabled"] is True


def _polled_times(arr_app, chat_id, n):
    async def enough():
        return arr_app.telegram.history_reads.count(chat_id) >= n
    return eventually(enough)


async def _control_source(arr_app):
    """A source with scanning on: being polled proves the loop is running."""
    await _source(arr_app, OTHER_CHAT, "Other")
    arr_app.post_episodes(OTHER_CHAT, "Other", [1])


@pytest.mark.asyncio
async def test_a_poll_makes_no_read_of_a_source_with_scanning_off(arr_app, polling):
    await _control_source(arr_app)
    _, reads = await _quiet_source(arr_app)

    async with polling():
        await _polled_times(arr_app, OTHER_CHAT, 3)

    assert arr_app.telegram.reads_of(CHAT) == reads


@pytest.mark.asyncio
async def test_a_poll_does_not_retry_a_failed_transfer_of_a_source_with_scanning_off(arr_app, polling):
    await _control_source(arr_app)
    await _quiet_source(arr_app)
    url = await arr_app.episode_url(SHOW, 1)
    arr_app.telegram.channels[CHAT].payloads.clear()      # the file can't be fetched
    await arr_app.grab(url)
    failed = await eventually(lambda: _status(arr_app, FILE, "failed"))
    reads = arr_app.telegram.reads_of(CHAT)

    async with polling():
        await _polled_times(arr_app, OTHER_CHAT, 3)

    assert arr_app.telegram.reads_of(CHAT) == reads
    assert (await arr_app.download(FILE))["retry_count"] == failed["retry_count"]


@pytest.mark.asyncio
async def test_a_source_turned_off_during_a_poll_pass_is_not_read_by_that_pass(arr_app, polling):
    tg = arr_app.telegram
    source, _ = await _quiet_source(arr_app)
    (await _set_scanning(arr_app, source["id"], True)).raise_for_status()
    await _control_source(arr_app)                        # newer: polled first in each pass
    tg.hold_history()

    async with polling():
        await _polled_times(arr_app, OTHER_CHAT, 1)       # the pass is under way, stuck on it
        reads = tg.reads_of(CHAT)
        (await _set_scanning(arr_app, source["id"], False)).raise_for_status()
        tg.release_history()
        await _polled_times(arr_app, OTHER_CHAT, 3)

    assert tg.reads_of(CHAT) == reads


@pytest.mark.asyncio
async def test_turning_scanning_back_on_resumes_polling(arr_app, polling):
    source, _ = await _quiet_source(arr_app)
    arr_app.post_episodes(CHAT, SHOW, [2])

    async with polling():
        (await _set_scanning(arr_app, source["id"], True)).raise_for_status()
        assert await arr_app.episode_url(SHOW, 2)


@pytest.mark.asyncio
async def test_newznab_keeps_offering_the_releases_of_a_source_with_scanning_off(arr_app):
    await _quiet_source(arr_app)

    assert await arr_app.episode_url(SHOW, 1)


@pytest.mark.asyncio
async def test_a_grab_of_a_source_with_scanning_off_still_transfers(arr_app):
    await _quiet_source(arr_app)

    nzo = await arr_app.grab(await arr_app.episode_url(SHOW, 1))
    slot = await arr_app.history_slot(nzo)

    assert slot["status"] == "Completed"
    assert arr_app.telegram.downloaded == [(CHAT, 1)]


async def _offered(arr_app) -> int:
    r = await arr_app.http.get("/api/newznab", params={"t": "tvsearch", "apikey": arr_app.apikey, "q": SHOW})
    return len(ET.fromstring(r.raise_for_status().text).findall("./channel/item"))


@pytest.mark.asyncio
async def test_disabling_hides_releases_whatever_scanning_says(arr_app):
    source, _ = await _quiet_source(arr_app)

    (await arr_app.http.patch(f"/api/channels/{source['id']}", json={"enabled": 0})).raise_for_status()
    assert await _offered(arr_app) == 0
    assert (await _channel(arr_app, source["id"]))["scanning"] == 0

    (await _set_scanning(arr_app, source["id"], True)).raise_for_status()
    assert await _offered(arr_app) == 0
    assert (await _channel(arr_app, source["id"]))["enabled"] == 0


@pytest.mark.asyncio
async def test_turning_scanning_off_leaves_a_source_enabled(arr_app):
    source, _ = await _quiet_source(arr_app)

    assert (await _channel(arr_app, source["id"]))["enabled"] == 1


@pytest.mark.asyncio
async def test_a_disabled_source_can_still_be_scanned_by_hand(arr_app):
    source, _ = await _quiet_source(arr_app)
    (await _set_scanning(arr_app, source["id"], True)).raise_for_status()
    (await arr_app.http.patch(f"/api/channels/{source['id']}", json={"enabled": 0})).raise_for_status()

    r = await arr_app.http.post(f"/api/channels/{source['id']}/scan")

    assert r.status_code == 200


@pytest.mark.asyncio
async def test_re_adding_a_source_keeps_its_scanning_off(arr_app):
    source, _ = await _quiet_source(arr_app)

    again = await arr_app.add_channel(CHAT)

    assert again["id"] == source["id"]
    assert (await _channel(arr_app, source["id"]))["scanning"] == 0


@pytest.fixture()
def directory_scans(monkeypatch):
    """Each directory scan really reads Telegram, with an open FloodWait gate."""
    from app import directory, downloader
    from app.safety import FloodGate

    monkeypatch.setattr(directory, "RESOLVE_INTERVAL_S", 0)
    monkeypatch.setattr(downloader, "flood_gate", FloodGate())
    directory.forget_scans()


async def _directory_scan(arr_app, chat_id=CHAT, topic_id=None):
    return await arr_app.http.post("/api/directory/scan", json={"chat_id": chat_id, "topic_id": topic_id})


@pytest.mark.asyncio
async def test_a_directory_scan_of_a_source_with_scanning_off_is_refused(arr_app, directory_scans):
    _, reads = await _quiet_source(arr_app)

    r = await _directory_scan(arr_app)

    assert r.status_code == 409
    assert r.json()["detail"]["key"] == "err.channel.scanning_off"
    assert arr_app.telegram.reads_of(CHAT) == reads


@pytest.mark.asyncio
async def test_a_directory_scan_of_a_chat_that_is_no_source_still_reads_it(arr_app, directory_scans):
    await _quiet_source(arr_app)
    arr_app.telegram.add_channel(OTHER_CHAT, "Other")

    r = await _directory_scan(arr_app, OTHER_CHAT)

    assert r.status_code == 200
    assert OTHER_CHAT in arr_app.telegram.history_reads


async def _forum_with_a_quiet_topic(arr_app):
    """A forum group with its first topic added as a source, scanning off."""
    forum = arr_app.telegram.add_forum(CHAT, "Club", topics=("Quiet", "Open"))
    source = await arr_app.add_channel(CHAT, topic_id=forum.topic_id("Quiet"))
    (await _set_scanning(arr_app, source["id"], False)).raise_for_status()
    return forum


@pytest.mark.asyncio
async def test_a_directory_scan_of_a_topic_with_scanning_off_is_refused(arr_app, directory_scans):
    forum = await _forum_with_a_quiet_topic(arr_app)

    r = await _directory_scan(arr_app, topic_id=forum.topic_id("Quiet"))

    assert r.status_code == 409


@pytest.mark.asyncio
async def test_a_directory_scan_of_a_whole_forum_is_refused_while_one_of_its_topics_is_off(arr_app, directory_scans):
    await _forum_with_a_quiet_topic(arr_app)

    r = await _directory_scan(arr_app)

    assert r.status_code == 409


@pytest.mark.asyncio
async def test_a_directory_scan_of_a_sibling_topic_still_reads_it(arr_app, directory_scans):
    forum = await _forum_with_a_quiet_topic(arr_app)

    r = await _directory_scan(arr_app, topic_id=forum.topic_id("Open"))

    assert r.status_code == 200


