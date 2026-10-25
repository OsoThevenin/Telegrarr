"""Activity log rows and download errors reach the UI as i18n keys, so they
show in the UI language; rows stored before keys existed keep their text.

Driven over HTTP (``arr_app``): Sonarr grabs through the SABnzbd shim, the UI
reads ``/api/logs`` and ``/api/downloads``.
"""
import pytest

from http_harness import eventually

CHAT = -1001000000077
FILE = "The.Show.S01E01.mkv"


async def _newest_log(arr_app) -> dict:
    return (await arr_app.http.get("/api/logs", params={"limit": 1})).raise_for_status().json()[0]


@pytest.mark.asyncio
async def test_pausing_downloads_logs_a_keyed_message(arr_app):
    (await arr_app.http.post("/api/queue/pause")).raise_for_status()

    row = await _newest_log(arr_app)

    assert row["msg"] == {"key": "event.downloads_paused", "params": {}}
    assert row["message"] == "Downloads paused"          # English text kept for search and old clients


@pytest.mark.asyncio
async def test_a_log_row_stored_before_keys_keeps_its_plain_text(arr_app):
    from app import db
    with db.conn() as c:   # a row as an older version wrote it
        c.execute("INSERT INTO logs(ts,level,message) VALUES(1,'INFO','Scanner started')")

    row = await _newest_log(arr_app)

    assert (row["msg"], row["message"]) == (None, "Scanner started")


@pytest.mark.asyncio
async def test_a_grab_logs_the_queued_file_as_a_keyed_message(arr_app):
    [url] = await arr_app.publish_episodes(CHAT, "The Show", 1)

    await arr_app.sab(mode="addurl", name=url, cat="tv")

    rows = (await arr_app.http.get("/api/logs")).raise_for_status().json()
    assert {"key": "event.grab_queued", "params": {"file": FILE}} in [r["msg"] for r in rows]


@pytest.mark.asyncio
async def test_a_cancelled_download_shows_a_keyed_reason(arr_app):
    [url] = await arr_app.publish_episodes(CHAT, "The Show", 1)
    arr_app.telegram.hold_downloads()
    await arr_app.sab(mode="addurl", name=url, cat="tv")
    queued = await eventually(lambda: arr_app.download(FILE))

    (await arr_app.http.post(f"/api/downloads/{queued['id']}/cancel")).raise_for_status()
    cancelled = await eventually(lambda: _cancelled(arr_app))
    arr_app.telegram.release_downloads()

    assert cancelled["error_msg"] == {"key": "dl.err.cancelled", "params": {}}


async def _cancelled(arr_app) -> dict | None:
    row = await arr_app.download(FILE)
    return row if row and row["status"] == "cancelled" else None
