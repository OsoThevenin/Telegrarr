"""Channel photos: the endpoint serves a cached Telegram profile photo, and showing
it costs no Telegram reads while the cache is fresh.

Driven over HTTP (``arr_app``) with Telegram faked at the client (``FakeTelegram``).
"""
import asyncio
import time

import pytest

from http_harness import eventually

CHAT = -1008100000001
OTHER_CHAT = -1008100000002
PHOTO = b"\xff\xd8 a small jpeg"
NEW_PHOTO = b"\xff\xd8 a newer jpeg"
EIGHT_DAYS_S = 8 * 24 * 3600
TWO_HOURS_S = 2 * 3600
NO_PHOTO = 404
SETTLE_S = 0.05


@pytest.fixture(autouse=True)
def isolated_photo_cache(tmp_path, monkeypatch):
    from app import channel_photos

    monkeypatch.setattr(channel_photos, "PHOTOS_DIR", str(tmp_path / "photos"))


@pytest.fixture()
def closed_gate_reset():
    """Reopen the process-wide flood gate after a test that closes it."""
    from app import downloader

    yield downloader.flood_gate
    downloader.flood_gate._until = 0.0


@pytest.fixture()
def own_read_slot(monkeypatch):
    """Give the read slot to this test: a contended semaphore binds to its event loop."""
    from app import channel_photos

    monkeypatch.setattr(channel_photos, "_read_slot", asyncio.Semaphore(1))


async def _source(arr_app, chat_id=CHAT, photo=PHOTO):
    arr_app.telegram.add_channel(chat_id, f"Channel {chat_id}").photo = photo
    return await arr_app.add_channel(chat_id)


def _photo(arr_app, source):
    return arr_app.http.get(f"/api/channels/{source['id']}/photo")


def _later(monkeypatch, seconds):
    """Move the photo cache's clock `seconds` ahead of now."""
    from app import channel_photos

    start = time.time()
    monkeypatch.setattr(channel_photos, "_now", lambda: start + seconds)


def _is_no_photo(response):
    return response.status_code == NO_PHOTO and response.json()["detail"]["key"] == "err.photo.none"


async def _set_scanning(arr_app, source, on):
    (await arr_app.http.patch(f"/api/channels/{source['id']}", json={"scanning": on})).raise_for_status()


async def _read_started(arr_app):
    return arr_app.telegram.photo_reads


@pytest.mark.asyncio
async def test_serves_the_telegram_photo_and_caches_it(arr_app):
    source = await _source(arr_app)

    first = await _photo(arr_app, source)
    reads = arr_app.telegram.reads_of(CHAT)
    second = await _photo(arr_app, source)

    assert (first.status_code, first.content) == (200, PHOTO)
    assert first.headers["content-type"] == "image/jpeg"
    assert (second.status_code, second.content) == (200, PHOTO)
    assert arr_app.telegram.photo_reads == [CHAT]
    assert arr_app.telegram.reads_of(CHAT) == reads


@pytest.mark.asyncio
async def test_a_photo_older_than_the_ttl_is_refreshed(arr_app, monkeypatch):
    source = await _source(arr_app)
    await _photo(arr_app, source)
    arr_app.telegram.channels[CHAT].photo = NEW_PHOTO

    _later(monkeypatch, EIGHT_DAYS_S)
    response = await _photo(arr_app, source)

    assert response.content == NEW_PHOTO
    assert arr_app.telegram.photo_reads == [CHAT, CHAT]


@pytest.mark.asyncio
async def test_a_channel_without_a_photo_is_remembered_within_the_ttl(arr_app):
    source = await _source(arr_app, photo=None)

    first = await _photo(arr_app, source)
    reads = arr_app.telegram.reads_of(CHAT)
    second = await _photo(arr_app, source)

    assert _is_no_photo(first) and _is_no_photo(second)
    assert arr_app.telegram.reads_of(CHAT) == reads


@pytest.mark.asyncio
async def test_a_photo_added_later_appears_after_the_ttl(arr_app, monkeypatch):
    source = await _source(arr_app, photo=None)
    await _photo(arr_app, source)
    arr_app.telegram.channels[CHAT].photo = PHOTO

    _later(monkeypatch, EIGHT_DAYS_S)

    assert (await _photo(arr_app, source)).content == PHOTO


@pytest.mark.asyncio
async def test_a_removed_photo_reports_no_photo_after_the_ttl(arr_app, monkeypatch):
    source = await _source(arr_app)
    await _photo(arr_app, source)
    arr_app.telegram.channels[CHAT].photo = None

    _later(monkeypatch, EIGHT_DAYS_S)

    assert _is_no_photo(await _photo(arr_app, source))


@pytest.mark.asyncio
async def test_scanning_off_with_nothing_cached_reads_nothing(arr_app):
    source = await _source(arr_app)
    await _set_scanning(arr_app, source, False)
    reads = arr_app.telegram.reads_of(CHAT)

    response = await _photo(arr_app, source)

    assert _is_no_photo(response)
    assert arr_app.telegram.reads_of(CHAT) == reads


@pytest.mark.asyncio
async def test_scanning_off_keeps_serving_an_expired_photo_without_reading(arr_app, monkeypatch):
    source = await _source(arr_app)
    await _photo(arr_app, source)
    await _set_scanning(arr_app, source, False)
    reads = arr_app.telegram.reads_of(CHAT)

    _later(monkeypatch, EIGHT_DAYS_S)
    response = await _photo(arr_app, source)

    assert response.content == PHOTO
    assert arr_app.telegram.reads_of(CHAT) == reads


@pytest.mark.asyncio
async def test_a_topic_source_cannot_read_a_chat_whose_whole_chat_source_is_off(arr_app):
    forum = arr_app.telegram.add_forum(CHAT, "Forum", topics=("Films",))
    forum.photo = PHOTO
    whole = await arr_app.add_channel(CHAT)
    topic = await arr_app.add_channel(CHAT, topic_id=forum.topic_id("Films"))
    await _set_scanning(arr_app, whole, False)

    assert _is_no_photo(await _photo(arr_app, topic))
    assert arr_app.telegram.photo_reads == []


@pytest.mark.asyncio
async def test_a_whole_chat_source_cannot_read_while_one_of_its_topics_is_off(arr_app):
    forum = arr_app.telegram.add_forum(CHAT, "Forum", topics=("Films",))
    forum.photo = PHOTO
    whole = await arr_app.add_channel(CHAT)
    topic = await arr_app.add_channel(CHAT, topic_id=forum.topic_id("Films"))
    await _set_scanning(arr_app, topic, False)

    assert _is_no_photo(await _photo(arr_app, whole))
    assert arr_app.telegram.photo_reads == []


@pytest.mark.asyncio
async def test_a_topic_source_still_reads_while_a_sibling_topic_is_off(arr_app):
    forum = arr_app.telegram.add_forum(CHAT, "Forum", topics=("Quiet", "Open"))
    forum.photo = PHOTO
    quiet = await arr_app.add_channel(CHAT, topic_id=forum.topic_id("Quiet"))
    open_topic = await arr_app.add_channel(CHAT, topic_id=forum.topic_id("Open"))
    await _set_scanning(arr_app, quiet, False)

    assert (await _photo(arr_app, open_topic)).content == PHOTO


@pytest.mark.asyncio
async def test_a_closed_flood_gate_holds_the_read(arr_app, closed_gate_reset):
    source = await _source(arr_app)
    await closed_gate_reset.trip(600)
    reads = arr_app.telegram.reads_of(CHAT)

    response = await _photo(arr_app, source)

    assert _is_no_photo(response)
    assert arr_app.telegram.reads_of(CHAT) == reads


@pytest.mark.asyncio
async def test_a_flood_wait_trips_the_gate_and_is_not_remembered_as_no_photo(arr_app, closed_gate_reset):
    source = await _source(arr_app)
    arr_app.telegram.flood_on_photo = True

    response = await _photo(arr_app, source)

    assert _is_no_photo(response)
    assert closed_gate_reset.minutes_closed() > 0

    closed_gate_reset._until = 0.0
    arr_app.telegram.flood_on_photo = False
    assert (await _photo(arr_app, source)).content == PHOTO


@pytest.mark.asyncio
async def test_a_spent_daily_budget_holds_the_read(arr_app):
    from app import safety, settings

    source = await _source(arr_app)
    settings.apply({"daily_budget_gb": 1})
    safety.record_download(safety.GB)
    reads = arr_app.telegram.reads_of(CHAT)

    assert _is_no_photo(await _photo(arr_app, source))
    assert arr_app.telegram.reads_of(CHAT) == reads


@pytest.mark.asyncio
async def test_a_fetched_photo_counts_against_the_daily_budget(arr_app):
    from app import safety

    source = await _source(arr_app)

    await _photo(arr_app, source)

    assert safety.budget_status()["used_bytes"] == len(PHOTO)


@pytest.mark.asyncio
async def test_concurrent_requests_share_one_read(arr_app):
    source = await _source(arr_app)
    arr_app.telegram.hold_photos()

    requests = [asyncio.create_task(_photo(arr_app, source)) for _ in range(5)]
    await eventually(lambda: _read_started(arr_app))
    await asyncio.sleep(SETTLE_S)
    arr_app.telegram.release_photos()
    responses = await asyncio.gather(*requests)

    assert [r.content for r in responses] == [PHOTO] * 5
    assert arr_app.telegram.photo_reads == [CHAT]


@pytest.mark.asyncio
async def test_a_grid_of_channels_reads_telegram_one_at_a_time(arr_app, own_read_slot):
    first = await _source(arr_app)
    second = await _source(arr_app, OTHER_CHAT)
    arr_app.telegram.hold_photos()

    requests = [asyncio.create_task(_photo(arr_app, s)) for s in (first, second)]
    await eventually(lambda: _read_started(arr_app))
    await asyncio.sleep(SETTLE_S)
    started = len(arr_app.telegram.photo_reads)
    arr_app.telegram.release_photos()
    await asyncio.gather(*requests)

    assert started == 1
    assert sorted(arr_app.telegram.photo_reads) == sorted([CHAT, OTHER_CHAT])


@pytest.mark.asyncio
async def test_scanning_turned_off_while_queued_stops_the_read(arr_app, own_read_slot):
    first = await _source(arr_app)
    second = await _source(arr_app, OTHER_CHAT)
    arr_app.telegram.hold_photos()
    blocking = asyncio.create_task(_photo(arr_app, first))
    await eventually(lambda: _read_started(arr_app))
    queued = asyncio.create_task(_photo(arr_app, second))
    await asyncio.sleep(SETTLE_S)

    await _set_scanning(arr_app, second, False)
    arr_app.telegram.release_photos()
    await asyncio.gather(blocking, queued)

    assert arr_app.telegram.photo_reads == [CHAT]


@pytest.mark.asyncio
async def test_a_chat_the_account_lost_is_not_retried_on_every_render(arr_app):
    source = await _source(arr_app)
    arr_app.telegram.lose_access(CHAT)

    first = await _photo(arr_app, source)
    reads = arr_app.telegram.reads_of(CHAT)
    second = await _photo(arr_app, source)

    assert _is_no_photo(first) and _is_no_photo(second)
    assert arr_app.telegram.reads_of(CHAT) == reads


@pytest.mark.asyncio
async def test_a_failed_read_is_retried_after_a_short_while(arr_app, monkeypatch):
    source = await _source(arr_app)
    arr_app.telegram.lose_access(CHAT)
    await _photo(arr_app, source)
    arr_app.telegram.inaccessible.clear()

    _later(monkeypatch, TWO_HOURS_S)

    assert (await _photo(arr_app, source)).content == PHOTO


@pytest.mark.asyncio
async def test_a_failed_refresh_keeps_serving_the_old_photo(arr_app, monkeypatch):
    source = await _source(arr_app)
    await _photo(arr_app, source)
    arr_app.telegram.lose_access(CHAT)

    _later(monkeypatch, EIGHT_DAYS_S)
    first = await _photo(arr_app, source)
    reads = arr_app.telegram.reads_of(CHAT)
    second = await _photo(arr_app, source)

    assert first.content == PHOTO and second.content == PHOTO
    assert arr_app.telegram.reads_of(CHAT) == reads


@pytest.mark.asyncio
async def test_two_sources_of_one_chat_share_the_cached_photo(arr_app):
    forum = arr_app.telegram.add_forum(CHAT, "Forum", topics=("Films", "Series"))
    forum.photo = PHOTO
    films = await arr_app.add_channel(CHAT, topic_id=forum.topic_id("Films"))
    series = await arr_app.add_channel(CHAT, topic_id=forum.topic_id("Series"))

    await _photo(arr_app, films)
    response = await _photo(arr_app, series)

    assert response.content == PHOTO
    assert arr_app.telegram.photo_reads == [CHAT]


@pytest.mark.asyncio
async def test_without_a_telegram_session_it_reports_no_photo(arr_app, monkeypatch):
    from app import tg

    source = await _source(arr_app)

    async def not_authorized():
        return None

    monkeypatch.setattr(tg, "authorized_client", not_authorized)

    assert _is_no_photo(await _photo(arr_app, source))


@pytest.mark.asyncio
async def test_an_unknown_channel_is_a_plain_404(arr_app):
    response = await arr_app.http.get("/api/channels/999/photo")

    assert (response.status_code, response.json()["detail"]) == (404, "Not Found")


@pytest.mark.asyncio
async def test_a_non_numeric_channel_id_never_reaches_the_cache(arr_app, tmp_path):
    response = await arr_app.http.get("/api/channels/..%2F..%2Fetc/photo")

    assert response.status_code in (404, 422)
    assert not (tmp_path / "photos").exists()


@pytest.mark.asyncio
async def test_the_photo_needs_a_signed_in_user(arr_app):
    source = await _source(arr_app)
    arr_app.http.cookies.clear()

    response = await _photo(arr_app, source)

    assert response.status_code == 401
    assert arr_app.telegram.photo_reads == []
