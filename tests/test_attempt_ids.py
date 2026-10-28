"""Each new attempt at a stopped download gets a fresh SABnzbd download id (#35).

Sonarr/Radarr write off an id they saw fail, so a re-grab or retry must be
reported under a new id. Attempt 0 keeps the legacy ``telearr<id>`` form.
Driven over HTTP (``arr_app``).
"""
import pytest

from http_harness import eventually

CHAT = -1001000000035
FILE = "The.Show.S01E01.mkv"


async def _status(arr_app, status: str) -> dict | None:
    row = await arr_app.download(FILE)
    return row if row and row["status"] == status else None


async def _queue_ids(arr_app) -> list[str]:
    return [s["nzo_id"] for s in (await arr_app.sab(mode="queue"))["queue"]["slots"]]


async def _history_ids(arr_app) -> list[str]:
    return [s["nzo_id"] for s in (await arr_app.sab(mode="history"))["history"]["slots"]]


async def _grab(arr_app, url: str) -> str:
    [nzo] = (await arr_app.sab(mode="addurl", name=url, cat="tv"))["nzo_ids"]
    return nzo


async def _grab_failed(arr_app) -> tuple[str, str, bytes]:
    """Grab episode 1 while its file can't be fetched; return its url, the failed
    attempt's id, and the payload to put back so a new attempt can succeed."""
    [url] = await arr_app.publish_episodes(CHAT, "The Show", 1)
    payload = arr_app.telegram.channels[CHAT].payloads.pop(1)
    nzo = await _grab(arr_app, url)
    assert (await arr_app.history_slot(nzo))["status"] == "Failed"
    return url, nzo, payload


async def _retried_and_failed(arr_app, retry_count: int) -> dict | None:
    row = await _status(arr_app, "failed")
    return row if row and row["retry_count"] == retry_count else None


def _restore(arr_app, payload: bytes) -> None:
    arr_app.telegram.channels[CHAT].payloads[1] = payload


@pytest.mark.asyncio
async def test_a_re_grab_of_a_failed_download_is_tracked_under_a_new_id(arr_app):
    url, old, payload = await _grab_failed(arr_app)
    _restore(arr_app, payload)
    arr_app.telegram.hold_downloads()

    new = await _grab(arr_app, url)
    await eventually(lambda: _status(arr_app, "downloading"))
    queue = await _queue_ids(arr_app)
    arr_app.telegram.release_downloads()
    slot = await arr_app.history_slot(new)

    assert new != old
    assert queue == [new]
    assert slot["status"] == "Completed"


@pytest.mark.asyncio
async def test_a_ui_retry_of_a_failed_arr_download_shows_a_new_id_in_the_queue(arr_app):
    _url, old, payload = await _grab_failed(arr_app)
    _restore(arr_app, payload)
    failed = await arr_app.download(FILE)
    arr_app.telegram.hold_downloads()

    r = await arr_app.http.post(f"/api/downloads/{failed['id']}/retry")
    queue = await _queue_ids(arr_app)
    arr_app.telegram.release_downloads()

    assert r.raise_for_status().json() == {"ok": True}
    assert len(queue) == 1 and queue != [old]
    assert (await arr_app.history_slot(queue[0]))["status"] == "Completed"


@pytest.mark.asyncio
async def test_an_auto_retry_on_the_next_scan_reports_a_new_id(arr_app):
    _url, old, payload = await _grab_failed(arr_app)
    _restore(arr_app, payload)
    [channel] = (await arr_app.http.get("/api/channels")).raise_for_status().json()

    await arr_app.scan(channel["id"])
    await eventually(lambda: _status(arr_app, "completed"))
    history = await _history_ids(arr_app)

    assert old not in history
    assert len(history) == 1


@pytest.mark.asyncio
async def test_a_first_attempt_keeps_the_legacy_id_for_queue_history_and_delete(arr_app):
    [url] = await arr_app.publish_episodes(CHAT, "The Show", 1)
    arr_app.telegram.hold_downloads()
    nzo = await _grab(arr_app, url)
    row = await eventually(lambda: _status(arr_app, "downloading"))
    queue = await _queue_ids(arr_app)
    arr_app.telegram.release_downloads()
    slot = await arr_app.history_slot(nzo)

    await arr_app.sab(mode="history", name="delete", value=f"telearr{row['id']}")

    assert nzo == f"telearr{row['id']}"
    assert queue == [nzo]
    assert slot["status"] == "Completed"
    assert await _history_ids(arr_app) == []


@pytest.mark.asyncio
async def test_a_re_grab_of_a_downloading_row_keeps_its_id(arr_app):
    [url] = await arr_app.publish_episodes(CHAT, "The Show", 1)
    arr_app.telegram.hold_downloads()
    first = await _grab(arr_app, url)
    await eventually(lambda: _status(arr_app, "downloading"))

    again = await _grab(arr_app, url)
    queue = await _queue_ids(arr_app)
    arr_app.telegram.release_downloads()

    assert again == first
    assert queue == [first]
    assert (await arr_app.history_slot(first))["status"] == "Completed"


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["queue", "history"])
async def test_a_delete_with_a_stale_id_leaves_the_current_attempt_downloading(arr_app, mode):
    url, old, payload = await _grab_failed(arr_app)
    _restore(arr_app, payload)
    arr_app.telegram.hold_downloads()
    new = await _grab(arr_app, url)
    await eventually(lambda: _status(arr_app, "downloading"))

    await arr_app.sab(mode=mode, name="delete", value=old)
    row = await arr_app.download(FILE)
    queue = await _queue_ids(arr_app)
    arr_app.telegram.release_downloads()

    assert row["status"] == "downloading"
    assert queue == [new]
    assert (await arr_app.history_slot(new))["status"] == "Completed"


@pytest.mark.asyncio
async def test_a_history_delete_with_a_stale_id_keeps_the_current_attempt_in_history(arr_app):
    url, old, payload = await _grab_failed(arr_app)
    _restore(arr_app, payload)
    new = await _grab(arr_app, url)
    await arr_app.history_slot(new)

    await arr_app.sab(mode="history", name="delete", value=old)
    kept = await _history_ids(arr_app)
    await arr_app.sab(mode="history", name="delete", value=new)

    assert kept == [new]
    assert await _history_ids(arr_app) == []


@pytest.mark.asyncio
async def test_a_queue_delete_with_the_current_attempt_id_cancels_it(arr_app):
    url, _old, payload = await _grab_failed(arr_app)
    _restore(arr_app, payload)
    arr_app.telegram.hold_downloads()
    new = await _grab(arr_app, url)
    await eventually(lambda: _status(arr_app, "downloading"))

    await arr_app.sab(mode="queue", name="delete", value=new)
    cancelled = await eventually(lambda: _status(arr_app, "cancelled"))
    arr_app.telegram.release_downloads()

    assert cancelled["status"] == "cancelled"
    assert await _queue_ids(arr_app) == []


@pytest.mark.asyncio
async def test_a_re_grab_keeps_the_auto_retries_already_used(arr_app):
    url, old, _payload = await _grab_failed(arr_app)
    [channel] = (await arr_app.http.get("/api/channels")).raise_for_status().json()
    await arr_app.scan(channel["id"])
    retried = await eventually(lambda: _retried_and_failed(arr_app, 1))

    again = await _grab(arr_app, url)
    slot = await arr_app.history_slot(again)
    after = await arr_app.download(FILE)

    assert again != old and slot["status"] == "Failed"
    assert (retried["retry_count"], after["retry_count"]) == (1, 1)
