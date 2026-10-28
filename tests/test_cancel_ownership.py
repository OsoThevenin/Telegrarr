"""Cancel always stops the task that is really downloading a row, and says
when there was nothing to stop.

Driven over HTTP (``arr_app``): Sonarr grabs and deletes through the SABnzbd
shim, the UI cancels through ``/api/downloads``. The fake Telegram holds
transfers so a row stays ``downloading`` while the test acts on it.
"""
import asyncio
import os

import pytest

from http_harness import eventually

CHAT = -1001000000032
FILE = "The.Show.S01E01.mkv"
SETTLE_S = 0.2   # time for a stray download task to publish a file, if one survived


def _files_named(root: str, name: str) -> list[str]:
    return [os.path.join(d, f) for d, _, files in os.walk(root) for f in files if f.startswith(name)]


async def _on_disk(root: str, name: str) -> list[str]:
    return _files_named(root, name)


async def _row_in(arr_app, file_name: str, status: str) -> dict | None:
    row = await arr_app.download(file_name)
    return row if row and row["status"] == status else None


async def _grab_held(arr_app, *episodes: int, partial: bool = False) -> tuple[list[str], list[str]]:
    """Grab ``episodes`` through the SABnzbd shim with transfers held; returns (nzo ids, NZB urls)."""
    urls = await arr_app.publish_episodes(CHAT, "The Show", *episodes)
    arr_app.telegram.hold_downloads(partial=partial)
    added = [await arr_app.sab(mode="addurl", name=url, cat="tv") for url in urls]
    return [a["nzo_ids"][0] for a in added], urls


@pytest.mark.asyncio
async def test_cancel_after_a_regrab_stops_the_running_download(arr_app, library_dirs):
    _, [url] = await _grab_held(arr_app, 1)
    running = await eventually(lambda: _row_in(arr_app, FILE, "downloading"))
    await arr_app.sab(mode="addurl", name=url, cat="tv")   # a second task for the same row

    cancel = (await arr_app.http.post(f"/api/downloads/{running['id']}/cancel")).raise_for_status().json()
    await eventually(lambda: _row_in(arr_app, FILE, "cancelled"))
    arr_app.telegram.release_downloads()
    await asyncio.sleep(SETTLE_S)

    assert cancel == {"ok": True}
    assert (await arr_app.download(FILE))["status"] == "cancelled"
    assert _files_named(library_dirs["DOWNLOADS_DIR"], FILE) == []


@pytest.mark.asyncio
async def test_cancelling_a_row_with_no_running_task_says_so(arr_app):
    [url] = await arr_app.publish_episodes(CHAT, "The Show", 1)
    await arr_app.sab(mode="addurl", name=url, cat="tv")
    done = await eventually(lambda: _row_in(arr_app, FILE, "completed"))

    cancel = (await arr_app.http.post(f"/api/downloads/{done['id']}/cancel")).raise_for_status().json()

    assert cancel == {"ok": False}
    assert (await arr_app.download(FILE))["status"] == "completed"


@pytest.mark.asyncio
async def test_cancelling_a_row_held_by_a_pause_cancels_it_for_good(arr_app, library_dirs):
    [url] = await arr_app.publish_episodes(CHAT, "The Show", 1)
    (await arr_app.http.post("/api/queue/pause")).raise_for_status()
    await arr_app.sab(mode="addurl", name=url, cat="tv")
    held = await eventually(lambda: _row_in(arr_app, FILE, "queued"))
    await asyncio.sleep(SETTLE_S)

    cancel = (await arr_app.http.post(f"/api/downloads/{held['id']}/cancel")).json()
    (await arr_app.http.post("/api/queue/resume")).raise_for_status()
    await asyncio.sleep(SETTLE_S)
    after = await arr_app.download(FILE)

    assert cancel == {"ok": True}
    assert (after["status"], after["error_msg"]) == \
        ("cancelled", {"key": "dl.err.cancelled", "params": {}})
    assert _files_named(library_dirs["DOWNLOADS_DIR"], FILE) == []


@pytest.mark.asyncio
async def test_bulk_cancel_counts_only_the_downloads_it_stopped(arr_app):
    [url1, url2] = await arr_app.publish_episodes(CHAT, "The Show", 1, 2)
    await arr_app.sab(mode="addurl", name=url2, cat="tv")
    idle = await eventually(lambda: _row_in(arr_app, "The.Show.S01E02.mkv", "completed"))
    arr_app.telegram.hold_downloads()
    await arr_app.sab(mode="addurl", name=url1, cat="tv")
    running = await eventually(lambda: _row_in(arr_app, FILE, "downloading"))

    r = await arr_app.http.post("/api/downloads/bulk",
                                json={"action": "cancel", "ids": [running["id"], idle["id"]]})
    await eventually(lambda: _row_in(arr_app, FILE, "cancelled"))
    arr_app.telegram.release_downloads()

    assert r.raise_for_status().json() == {"ok": True, "count": 1}


@pytest.mark.asyncio
async def test_sab_queue_delete_of_a_downloading_item_cancels_it_and_removes_the_partial(
        arr_app, library_dirs):
    [nzo], [url] = await _grab_held(arr_app, 1, partial=True)
    await eventually(lambda: _row_in(arr_app, FILE, "downloading"))
    await eventually(lambda: _on_disk(library_dirs["DOWNLOADS_DIR"], FILE))   # the partial .tmp
    await arr_app.sab(mode="addurl", name=url, cat="tv")   # Sonarr re-sends the grab

    await arr_app.sab(mode="queue", name="delete", value=nzo)
    cancelled = await eventually(lambda: _row_in(arr_app, FILE, "cancelled"))
    arr_app.telegram.release_downloads()
    await asyncio.sleep(SETTLE_S)

    assert cancelled["error_msg"] == {"key": "dl.err.cancelled", "params": {}}
    assert (await arr_app.download(FILE))["status"] == "cancelled"
    assert _files_named(library_dirs["DOWNLOADS_DIR"], FILE) == []
