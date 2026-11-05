"""History fetch on a TV Channel: one Release per episode, the largest.

A history batch compares its largest copy of an episode with the Releases the
Channel already holds, so a copy in another batch can't become a second Release.
Polls and Movie channels keep offering what they find.

Driven over HTTP (``arr_app``) with the real scan loop and Telegram faked at the
client; assertions look at what Newznab offers and at what gets transferred.
"""
import os
import xml.etree.ElementTree as ET

import pytest

from app import db
from fake_tmdb import API_KEY as TMDB_KEY
from http_harness import eventually

CHAT = -1001080000001
OTHER_CHAT = -1001080000002
SHOW = "The Show"
EPISODE = 7
SMALL, MEDIUM, LARGE = 1287, 1900, 2774     # bytes, like the 1287 MB and 2774 MB copies of S21E02
BATCH = 200                 # messages one history batch asks Telegram for
FIRST_SCAN = 80             # newest messages a scan reads
TMDB_FILM, OTHER_TMDB_FILM = 50797, 266856


def _post_copy(arr_app, size, episode=EPISODE, chat_id=CHAT):
    return arr_app.telegram.post(chat_id, text=f"{SHOW} S01E{episode:02d} 1080p",
                                 file_name=f"The.Show.S01E{episode:02d}.mkv", content=b"x" * size)


def _chatter(arr_app, count, chat_id=CHAT):
    for n in range(count):
        arr_app.telegram.post_text(chat_id, f"chatter {n}")


async def _source_with_copies(arr_app, older, newer):
    """A scanned series channel with the sizes ``older`` and ``newer`` of one episode,
    each in its own history batch; returns (source, older message, newer message)."""
    arr_app.telegram.add_channel(CHAT, SHOW)
    old = _post_copy(arr_app, older)
    _chatter(arr_app, BATCH)
    new = _post_copy(arr_app, newer)
    _chatter(arr_app, FIRST_SCAN)
    source = await arr_app.add_channel(CHAT)
    await arr_app.scan(source["id"])
    return source, old, new


async def _polled_source_with_copies(arr_app, older, newer):
    """A series channel whose first scan offered the ``newer`` copy of one episode and
    left the ``older`` one for its history; returns (source, older message, newer message)."""
    arr_app.telegram.add_channel(CHAT, SHOW)
    old = _post_copy(arr_app, older)
    _chatter(arr_app, FIRST_SCAN)
    new = _post_copy(arr_app, newer)
    source = await arr_app.add_channel(CHAT)
    await arr_app.scan(source["id"])
    return source, old, new


async def _search(arr_app, *, t="tvsearch", q=SHOW, **params):
    r = await arr_app.http.get("/api/newznab", params={"t": t, "apikey": arr_app.apikey, "q": q, **params})
    return ET.fromstring(r.raise_for_status().text).findall("./channel/item")


def _items(arr_app, episode=EPISODE):
    return _search(arr_app, season=1, ep=episode)


async def _sizes(arr_app, episode=EPISODE):
    """The sizes of the copies Newznab offers of ``episode``, largest first."""
    return sorted((int(i.find("enclosure").attrib["length"]) for i in await _items(arr_app, episode)),
                  reverse=True)


def _is_message(item, source, msg):
    return item.find("guid").text.endswith(f"{source['id']}-{msg.id}")


async def _logged(arr_app, source, key):
    logs = (await arr_app.http.get("/api/logs", params={"channel_id": source["id"]})).json()
    return sum((row["msg"] or {}).get("key") == key for row in logs)


async def _history_finished(arr_app, source, times=1):
    """Wait until the source's history finished, the ``times``-th time when read again."""
    async def probe():
        return await _logged(arr_app, source, "event.backfill_done") >= times
    await eventually(probe)


async def _indexing_failed(arr_app, source):
    async def probe():
        return await _logged(arr_app, source, "event.scan_failed")
    await eventually(probe)


async def _rescan(arr_app, source):
    """Scan the source again and wait until it reached the channel's newest message."""
    newest = arr_app.telegram.channels[CHAT].next_message_id() - 1
    (await arr_app.http.post(f"/api/channels/{source['id']}/scan")).raise_for_status()

    async def probe():
        rows = (await arr_app.http.get("/api/channels")).raise_for_status().json()
        return next(c for c in rows if c["id"] == source["id"])["last_message_id"] == newest
    await eventually(probe)


async def _recover_history(arr_app, source):
    (await arr_app.http.post(f"/api/channels/{source['id']}/backfill")).raise_for_status()


async def _go_standalone(arr_app):
    r = await arr_app.http.patch("/api/settings", json={"operating_mode": "standalone"})
    r.raise_for_status()


async def _downloads(arr_app):
    return (await arr_app.http.get("/api/downloads")).raise_for_status().json()


async def _transferred(arr_app, msg):
    """Wait until the fake Telegram handed over the file of ``msg``."""
    async def probe():
        return (CHAT, msg.id) in arr_app.telegram.downloaded
    await eventually(probe)


async def _walk(arr_app, batches_only, source):
    """Read the source's whole history."""
    async with batches_only():
        await _history_finished(arr_app, source)


@pytest.mark.asyncio
async def test_a_smaller_copy_in_an_older_batch_is_not_offered(arr_app, batches_only):
    source, _, _ = await _source_with_copies(arr_app, older=SMALL, newer=LARGE)

    await _walk(arr_app, batches_only, source)

    assert await _sizes(arr_app) == [LARGE]


@pytest.mark.asyncio
async def test_an_equal_copy_in_an_older_batch_is_not_offered(arr_app, batches_only):
    source, _, newer = await _source_with_copies(arr_app, older=LARGE, newer=LARGE)

    await _walk(arr_app, batches_only, source)

    [item] = await _items(arr_app)
    assert _is_message(item, source, newer)


@pytest.mark.asyncio
async def test_a_larger_copy_in_an_older_batch_replaces_the_smaller_release(arr_app, batches_only):
    source, older, _ = await _source_with_copies(arr_app, older=LARGE, newer=SMALL)

    await _walk(arr_app, batches_only, source)

    [item] = await _items(arr_app)
    assert _is_message(item, source, older)
    assert await _sizes(arr_app) == [LARGE]


@pytest.mark.asyncio
async def test_a_larger_copy_leaves_only_itself_of_several_smaller_releases(arr_app, batches_only):
    source, _, _ = await _polled_source_with_copies(arr_app, older=LARGE, newer=SMALL)
    _post_copy(arr_app, MEDIUM)                 # a poll offers a re-upload next to it
    await _rescan(arr_app, source)
    offered_by_polls = await _sizes(arr_app)

    await _walk(arr_app, batches_only, source)

    assert offered_by_polls == [MEDIUM, SMALL]
    assert await _sizes(arr_app) == [LARGE]


@pytest.mark.asyncio
async def test_reading_a_history_again_keeps_the_release_it_finds(arr_app, batches_only):
    source, _, newer = await _source_with_copies(arr_app, older=SMALL, newer=LARGE)
    await _walk(arr_app, batches_only, source)
    [before] = await _items(arr_app)

    async with batches_only():
        await _recover_history(arr_app, source)
        await _history_finished(arr_app, source, times=2)

    [item] = await _items(arr_app)
    assert _is_message(item, source, newer)
    assert item.find("pubDate").text == before.find("pubDate").text


@pytest.mark.asyncio
async def test_reading_a_message_again_updates_its_release(arr_app, batches_only):
    source, _, newer = await _source_with_copies(arr_app, older=SMALL, newer=LARGE)
    await _walk(arr_app, batches_only, source)
    arr_app.telegram.post(CHAT, text=f"{SHOW} S01E{EPISODE:02d}", file_name=f"The.Show.S01E{EPISODE:02d}.720p.mkv",
                          content=b"x" * LARGE, message_id=newer.id)

    async with batches_only():
        await _recover_history(arr_app, source)
        await _history_finished(arr_app, source, times=2)

    [item] = await _items(arr_app)
    assert "720p" in item.find("title").text


@pytest.mark.asyncio
async def test_a_failure_while_replacing_leaves_the_smaller_release_and_the_batch_is_read_again(
        arr_app, batches_only):
    source, older, _ = await _source_with_copies(arr_app, older=LARGE, newer=SMALL)
    with db.conn() as c:        # no HTTP route to a failing write: the database refuses it
        c.execute("""CREATE TRIGGER refuse_removal BEFORE DELETE ON releases
                     BEGIN SELECT RAISE(ABORT, 'disk full'); END""")

    async with batches_only():
        await _indexing_failed(arr_app, source)
        while_failing = await _sizes(arr_app)
        with db.conn() as c:
            c.execute("DROP TRIGGER refuse_removal")
        await _history_finished(arr_app, source)

    assert while_failing == [SMALL]
    [item] = await _items(arr_app)
    assert _is_message(item, source, older)


@pytest.mark.asyncio
async def test_a_manual_recovery_does_not_queue_a_skipped_copy(arr_app, batches_only):
    source, _, _ = await _polled_source_with_copies(arr_app, older=SMALL, newer=LARGE)     # offered, not queued
    await _go_standalone(arr_app)

    await _recover_history(arr_app, source)
    async with batches_only():
        await _history_finished(arr_app, source)

    assert await _downloads(arr_app) == []


@pytest.mark.asyncio
async def test_a_manual_recovery_queues_a_larger_copy_of_what_was_transferred(arr_app, batches_only):
    source, older, _ = await _polled_source_with_copies(arr_app, older=LARGE, newer=SMALL)
    await arr_app.history_slot(await arr_app.grab(await arr_app.episode_url(SHOW, EPISODE)))
    await _go_standalone(arr_app)

    await _recover_history(arr_app, source)
    async with batches_only():
        await _history_finished(arr_app, source)

    assert await _sizes(arr_app) == [LARGE]
    await _transferred(arr_app, older)


@pytest.mark.asyncio
async def test_unnumbered_messages_stay_separate_releases(arr_app, batches_only):
    arr_app.telegram.add_channel(CHAT, SHOW)
    old = arr_app.telegram.post(CHAT, text="Especial de Nadal", file_name="especial.mkv", content=b"x" * LARGE)
    _chatter(arr_app, BATCH)
    new = arr_app.telegram.post(CHAT, text="Especial de Nadal", file_name="especial.mkv", content=b"x" * SMALL)
    _chatter(arr_app, FIRST_SCAN)
    source = await arr_app.add_channel(CHAT)
    await arr_app.scan(source["id"])

    await _walk(arr_app, batches_only, source)

    guids = {i.find("guid").text for i in await _search(arr_app)}
    assert guids == {f"telearr-{source['id']}-{old.id}", f"telearr-{source['id']}-{new.id}"}


@pytest.mark.asyncio
async def test_the_parts_of_an_episode_stay_separate_releases(arr_app, batches_only):
    arr_app.telegram.add_channel(CHAT, SHOW)
    arr_app.telegram.post(CHAT, text=f"{SHOW} S01E{EPISODE:02d} (1a Part)",
                          file_name=f"The.Show.S01E{EPISODE:02d}.(1a Part).mkv", content=b"x" * LARGE)
    _chatter(arr_app, BATCH)
    arr_app.telegram.post(CHAT, text=f"{SHOW} S01E{EPISODE:02d} (2a Part)",
                          file_name=f"The.Show.S01E{EPISODE:02d}.(2a Part).mkv", content=b"x" * SMALL)
    _chatter(arr_app, FIRST_SCAN)
    source = await arr_app.add_channel(CHAT)
    await arr_app.scan(source["id"])

    await _walk(arr_app, batches_only, source)

    assert await _sizes(arr_app) == [LARGE, SMALL]


@pytest.mark.asyncio
async def test_another_channels_copy_of_an_episode_is_left_alone(arr_app, batches_only):
    arr_app.telegram.add_channel(OTHER_CHAT, SHOW)
    _post_copy(arr_app, LARGE, chat_id=OTHER_CHAT)
    other = await arr_app.add_channel(OTHER_CHAT)
    await arr_app.scan(other["id"])
    source, _, _ = await _source_with_copies(arr_app, older=SMALL, newer=MEDIUM)

    await _walk(arr_app, batches_only, source)

    assert await _sizes(arr_app) == [LARGE, MEDIUM]


@pytest.mark.asyncio
async def test_a_poll_still_offers_a_smaller_re_upload(arr_app):
    arr_app.telegram.add_channel(CHAT, SHOW)
    _post_copy(arr_app, LARGE)
    source = await arr_app.add_channel(CHAT)
    await arr_app.scan(source["id"])
    _post_copy(arr_app, SMALL)

    await _rescan(arr_app, source)

    assert await _sizes(arr_app) == [LARGE, SMALL]


@pytest.mark.asyncio
async def test_a_movie_channels_history_keeps_films_that_look_like_one_episode(arr_app, batches_only, fake_tmdb):
    fake_tmdb.add_movie(TMDB_FILM, titles={"ca-ES": "Pa negre", "en-US": "Black Bread"},
                        release_date="2010-10-15")
    fake_tmdb.add_movie(OTHER_TMDB_FILM, titles={"ca-ES": "La teoria del tot", "en-US": "The Theory of Everything"},
                        release_date="2014-11-07")
    (await arr_app.http.patch("/api/settings", json={"tmdb_key": TMDB_KEY})).raise_for_status()
    arr_app.telegram.add_channel(CHAT, "Pel·lícules")
    arr_app.telegram.post(CHAT, text="Pa negre (2010)", file_name="Pa.negre.2010.Ep05.mkv", content=b"x" * SMALL)
    _chatter(arr_app, BATCH)
    arr_app.telegram.post(CHAT, text="La teoria del tot (2014)", file_name="La.teoria.del.tot.2014.Ep05.mkv",
                          content=b"x" * LARGE)
    _chatter(arr_app, FIRST_SCAN)
    source = await arr_app.add_channel(CHAT, kind="movie")
    await arr_app.scan(source["id"])

    await _walk(arr_app, batches_only, source)

    assert len(await _search(arr_app, t="movie", q="")) == 2


async def _grab_by_url(arr_app, url):
    return await arr_app.grab(url)


async def _grab_by_nzb_file(arr_app, url):
    """Fetch the NZB and upload it, as Sonarr's SABnzbd client does."""
    nzb = (await arr_app.http.get(url)).raise_for_status().content
    r = await arr_app.http.post("/sabnzbd/api", params={"mode": "addfile", "apikey": arr_app.apikey, "cat": "tv"},
                                files={"name": ("release.nzb", nzb, "application/x-nzb")})
    [nzo] = r.raise_for_status().json()["nzo_ids"]
    return nzo


def _title_and_url(item):
    return item.find("title").text, item.find("enclosure").attrib["url"]


@pytest.mark.asyncio
@pytest.mark.parametrize("grab", [_grab_by_url, _grab_by_nzb_file])
async def test_a_grab_of_a_removed_release_still_transfers_under_its_title(arr_app, batches_only, grab):
    source, _, newer = await _polled_source_with_copies(arr_app, older=LARGE, newer=SMALL)
    [held_by_sonarr] = await _items(arr_app)
    title, url = _title_and_url(held_by_sonarr)
    await _walk(arr_app, batches_only, source)
    still_offered = await _sizes(arr_app)

    slot = await arr_app.history_slot(await grab(arr_app, url))

    assert still_offered == [LARGE]
    assert slot["status"] == "Completed"
    assert slot["name"] == title
    assert os.path.basename(slot["storage"]) == title
    assert (CHAT, newer.id) in arr_app.telegram.downloaded
    assert os.path.getsize(os.path.join(slot["storage"], newer.document.file_name)) == SMALL


@pytest.mark.asyncio
async def test_a_transfer_running_when_its_release_is_replaced_is_unaffected(arr_app, batches_only):
    tg = arr_app.telegram
    source, _, newer = await _polled_source_with_copies(arr_app, older=LARGE, newer=SMALL)
    [held_by_sonarr] = await _items(arr_app)
    title, url = _title_and_url(held_by_sonarr)
    tg.hold_downloads()
    nzo = await arr_app.grab(url)

    await _walk(arr_app, batches_only, source)
    [slot] = (await arr_app.sab(mode="queue"))["queue"]["slots"]
    tg.release_downloads()
    finished = await arr_app.history_slot(nzo)

    assert await _sizes(arr_app) == [LARGE]
    assert (slot["nzo_id"], slot["filename"]) == (nzo, title)
    assert (finished["status"], finished["name"]) == ("Completed", title)
    assert os.path.getsize(os.path.join(finished["storage"], newer.document.file_name)) == SMALL
