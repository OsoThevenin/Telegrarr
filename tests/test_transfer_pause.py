"""A transfer can be paused and resumed on its own (single and bulk), and stays
paused until resumed, whatever else happens to the queue (#82).

Driven over HTTP (``arr_app``): Sonarr grabs through the SABnzbd shim, the UI
pauses and resumes through ``/api/downloads``. The fake Telegram holds transfers
so a row stays ``downloading`` while the test acts on it.
"""
import asyncio
import os

import pytest

from app import scanner, settings, transfers
from app.main import app, lifespan
from http_harness import eventually

CHAT = -1001000000082
FILE = "The.Show.S01E01.mkv"
FILE_2 = "The.Show.S01E02.mkv"
SETTLE_S = 0.2   # time for a stray download task to change a row, if one survived


def _files_named(root: str, name: str) -> list[str]:
    return [os.path.join(d, f) for d, _, files in os.walk(root) for f in files if f.startswith(name)]


async def _in_status(arr_app, status: str, file_name: str = FILE) -> dict | None:
    row = await arr_app.download(file_name)
    return row if row and row["status"] == status else None


async def _downloading(arr_app, *, partial: bool = False, **hold) -> tuple[dict, str]:
    """Grab episode 1 with its transfer held; returns its row and nzo id."""
    [url] = await arr_app.publish_episodes(CHAT, "The Show", 1)
    arr_app.telegram.hold_downloads(partial=partial, **hold)
    nzo = await arr_app.grab(url)
    return await eventually(lambda: _in_status(arr_app, "downloading")), nzo


async def _pause(arr_app, row: dict) -> dict:
    return (await arr_app.http.post(f"/api/downloads/{row['id']}/pause")).raise_for_status().json()


async def _resume(arr_app, row: dict) -> dict:
    return (await arr_app.http.post(f"/api/downloads/{row['id']}/resume")).raise_for_status().json()


@pytest.mark.asyncio
async def test_pausing_an_in_flight_transfer_stops_it_and_discards_the_partial_file(
        arr_app, library_dirs):
    row, _ = await _downloading(arr_app, partial=True)
    assert _files_named(library_dirs["DOWNLOADS_DIR"], FILE)

    paused = await _pause(arr_app, row)
    arr_app.telegram.release_downloads()
    await asyncio.sleep(SETTLE_S)

    assert paused == {"ok": True}
    after = await arr_app.download(FILE)
    assert (after["status"], after["error_msg"], after["progress"]) == ("paused", None, 0)
    assert _files_named(library_dirs["DOWNLOADS_DIR"], FILE) == []
    assert arr_app.telegram.downloaded == []


@pytest.mark.asyncio
async def test_resuming_restarts_the_file_under_the_same_download_id(arr_app, library_dirs):
    row, nzo = await _downloading(arr_app, partial=True)
    await _pause(arr_app, row)
    await asyncio.sleep(SETTLE_S)
    partial_after_pause = _files_named(library_dirs["DOWNLOADS_DIR"], FILE)
    arr_app.telegram.release_downloads()

    resumed = await _resume(arr_app, row)
    await eventually(lambda: _in_status(arr_app, "completed"))

    assert resumed == {"ok": True}
    assert partial_after_pause == []
    assert arr_app.telegram.downloaded == [(CHAT, 1)]
    assert (await arr_app.history_slot(nzo))["status"] == "Completed"


@pytest.mark.asyncio
async def test_the_sab_queue_keeps_the_download_id_of_a_resumed_transfer(arr_app):
    row, nzo = await _downloading(arr_app, late_outcome=asyncio.CancelledError)
    await _pause(arr_app, row)
    await _resume(arr_app, row)

    queue = (await arr_app.sab(mode="queue"))["queue"]["slots"]
    arr_app.telegram.release_downloads()

    assert [s["nzo_id"] for s in queue] == [nzo]
    await eventually(lambda: _in_status(arr_app, "completed"))


@pytest.mark.asyncio
async def test_an_arr_delete_of_a_resumed_transfer_cancels_it(arr_app):
    row, nzo = await _downloading(arr_app)
    await _pause(arr_app, row)
    await asyncio.sleep(SETTLE_S)
    await _resume(arr_app, row)
    await eventually(lambda: _in_status(arr_app, "downloading"))

    await arr_app.sab(mode="queue", name="delete", value=nzo)
    cancelled = await eventually(lambda: _in_status(arr_app, "cancelled"))
    arr_app.telegram.release_downloads()
    await asyncio.sleep(SETTLE_S)

    assert cancelled["error_msg"] == {"key": "dl.err.cancelled", "params": {}}
    assert (await arr_app.download(FILE))["status"] == "cancelled"


@pytest.mark.asyncio
async def test_a_transfer_retried_after_a_resume_gets_a_new_download_id(arr_app):
    row, nzo = await _downloading(arr_app)
    await _pause(arr_app, row)
    await asyncio.sleep(SETTLE_S)
    await _resume(arr_app, row)
    await eventually(lambda: _in_status(arr_app, "downloading"))
    (await arr_app.http.post(f"/api/downloads/{row['id']}/cancel")).raise_for_status()
    await eventually(lambda: _in_status(arr_app, "cancelled"))
    await asyncio.sleep(SETTLE_S)
    arr_app.telegram.release_downloads()

    retried = (await arr_app.http.post(f"/api/downloads/{row['id']}/retry")).raise_for_status().json()
    await eventually(lambda: _in_status(arr_app, "completed"))

    assert retried == {"ok": True}
    assert (await arr_app.history_ids()) == [f"{nzo}-1"]


@pytest.mark.asyncio
async def test_resuming_a_row_that_is_not_paused_says_so(arr_app):
    row, _ = await _downloading(arr_app)

    resumed = await _resume(arr_app, row)
    arr_app.telegram.release_downloads()

    assert resumed == {"ok": False, "reason": "dl.not_paused"}


@pytest.mark.asyncio
async def test_resuming_after_the_message_was_deleted_keeps_the_row_paused(arr_app):
    row, _ = await _downloading(arr_app)
    await _pause(arr_app, row)
    del arr_app.telegram.channels[CHAT].messages[1]

    resumed = await _resume(arr_app, row)
    arr_app.telegram.release_downloads()

    assert resumed == {"ok": False, "reason": "dl.err.message_gone"}
    assert (await arr_app.download(FILE))["status"] == "paused"


@pytest.mark.asyncio
async def test_pausing_a_finished_row_changes_nothing(arr_app):
    [url] = await arr_app.publish_episodes(CHAT, "The Show", 1)
    await arr_app.grab(url)
    done = await eventually(lambda: _in_status(arr_app, "completed"))

    paused = await _pause(arr_app, done)

    assert paused == {"ok": False}
    assert (await arr_app.download(FILE))["status"] == "completed"


@pytest.mark.asyncio
async def test_a_retry_does_not_start_a_paused_row(arr_app):
    row, _ = await _downloading(arr_app)
    await _pause(arr_app, row)
    arr_app.telegram.release_downloads()

    r = await arr_app.http.post(f"/api/downloads/{row['id']}/retry")
    await asyncio.sleep(SETTLE_S)

    assert r.raise_for_status().json()["ok"] is False
    assert (await arr_app.download(FILE))["status"] == "paused"


async def _grab_held(arr_app, *episodes: int) -> dict[int, dict]:
    """Grab ``episodes`` while the global queue is paused: rows queued with no
    task, as a graceful shutdown leaves them. Returns the rows by episode."""
    urls = await arr_app.publish_episodes(CHAT, "The Show", *episodes)
    (await arr_app.http.post("/api/queue/pause")).raise_for_status()
    rows = {}
    for ep, url in zip(episodes, urls):
        await arr_app.grab(url)
        name = f"The.Show.S01E{ep:02d}.mkv"
        rows[ep] = await eventually(lambda n=name: _in_status(arr_app, "queued", n))
    return rows


@pytest.mark.asyncio
async def test_a_paused_queued_transfer_is_held_while_the_rest_of_the_queue_runs(arr_app):
    (await arr_app.http.patch("/api/settings", json={"max_concurrent": 1})).raise_for_status()
    urls = await arr_app.publish_episodes(CHAT, "The Show", 1, 2)
    arr_app.telegram.hold_downloads()
    await arr_app.grab(urls[0])
    await eventually(lambda: _in_status(arr_app, "downloading"))
    await arr_app.grab(urls[1])
    waiting = await eventually(lambda: _in_status(arr_app, "queued", FILE_2))

    paused = await _pause(arr_app, waiting)
    arr_app.telegram.release_downloads()
    await eventually(lambda: _in_status(arr_app, "completed"))
    await asyncio.sleep(SETTLE_S)

    assert paused == {"ok": True}
    assert (await arr_app.download(FILE_2))["status"] == "paused"
    assert arr_app.telegram.downloaded == [(CHAT, 1)]


@pytest.mark.asyncio
async def test_bulk_pause_and_bulk_resume_act_on_a_list_of_ids(arr_app):
    urls = await arr_app.publish_episodes(CHAT, "The Show", 1, 2)
    arr_app.telegram.hold_downloads()
    for url in urls:
        await arr_app.grab(url)
    rows = [await eventually(lambda n=name: _in_status(arr_app, "downloading", n))
            for name in (FILE, FILE_2)]
    ids = [r["id"] for r in rows]

    paused = await arr_app.http.post("/api/downloads/bulk", json={"action": "pause", "ids": [*ids, 999]})
    await asyncio.sleep(SETTLE_S)
    after_pause = [(await arr_app.download(n))["status"] for n in (FILE, FILE_2)]
    arr_app.telegram.release_downloads()
    resumed = await arr_app.http.post("/api/downloads/bulk", json={"action": "resume", "ids": ids})
    await eventually(lambda: _in_status(arr_app, "completed"))
    await eventually(lambda: _in_status(arr_app, "completed", FILE_2))

    assert paused.raise_for_status().json() == {"ok": True, "count": 2}
    assert after_pause == ["paused", "paused"]
    assert resumed.raise_for_status().json() == {"ok": True, "count": 2}


@pytest.mark.asyncio
async def test_a_paused_transfer_stays_paused_when_the_global_queue_resumes(arr_app):
    rows = await _grab_held(arr_app, 1, 2)
    await _pause(arr_app, rows[1])

    (await arr_app.http.post("/api/queue/resume")).raise_for_status()
    await eventually(lambda: _in_status(arr_app, "completed", FILE_2))
    await asyncio.sleep(SETTLE_S)

    assert (await arr_app.download(FILE))["status"] == "paused"
    assert arr_app.telegram.downloaded == [(CHAT, 2)]


@pytest.mark.asyncio
async def test_a_transfer_running_through_a_global_pause_and_resume_still_completes(arr_app):
    await _downloading(arr_app)   # a global resume puts a running row back to queued

    (await arr_app.http.post("/api/queue/pause")).raise_for_status()
    (await arr_app.http.post("/api/queue/resume")).raise_for_status()
    arr_app.telegram.release_downloads()

    await eventually(lambda: _in_status(arr_app, "completed"))


@pytest.mark.asyncio
async def test_a_resume_while_the_global_queue_is_paused_waits_for_the_queue(arr_app):
    rows = await _grab_held(arr_app, 1)
    await _pause(arr_app, rows[1])

    resumed = await _resume(arr_app, rows[1])
    await asyncio.sleep(SETTLE_S)
    held = (await arr_app.download(FILE))["status"]
    (await arr_app.http.post("/api/queue/resume")).raise_for_status()

    assert resumed == {"ok": True}
    assert held == "queued"
    await eventually(lambda: _in_status(arr_app, "completed"))


@pytest.mark.asyncio
async def test_a_paused_transfer_stays_paused_across_a_restart(arr_app, monkeypatch):
    rows = await _grab_held(arr_app, 1, 2)
    await _pause(arr_app, rows[1])
    settings.set("paused", "0")   # the queue was running when the process stopped
    monkeypatch.setattr(transfers, "_shutting_down", False)

    async with lifespan(app):
        await eventually(lambda: _in_status(arr_app, "completed", FILE_2))
        scanner._active.cancel()
    await asyncio.sleep(SETTLE_S)

    assert (await arr_app.download(FILE))["status"] == "paused"
    assert arr_app.telegram.downloaded == [(CHAT, 2)]


@pytest.mark.asyncio
async def test_a_shutdown_while_the_paused_transfer_winds_down_keeps_it_paused(
        arr_app, library_dirs, monkeypatch):
    row, _ = await _downloading(arr_app, partial=True, late_outcome=asyncio.CancelledError)
    await _pause(arr_app, row)
    monkeypatch.setattr(transfers, "_shutting_down", True)

    arr_app.telegram.release_downloads()
    await asyncio.sleep(SETTLE_S)

    assert (await arr_app.download(FILE))["status"] == "paused"
    assert _files_named(library_dirs["DOWNLOADS_DIR"], FILE) == []


@pytest.mark.asyncio
async def test_the_sab_queue_reports_a_paused_transfer_as_paused_not_as_history(arr_app):
    row, nzo = await _downloading(arr_app)
    await _pause(arr_app, row)
    arr_app.telegram.release_downloads()
    await asyncio.sleep(SETTLE_S)

    queue = (await arr_app.sab(mode="queue"))["queue"]

    assert [(s["nzo_id"], s["status"], s["percentage"]) for s in queue["slots"]] == [(nzo, "Paused", "0")]
    assert queue["paused"] is False
    assert await arr_app.history_ids() == []


@pytest.mark.asyncio
async def test_an_arr_delete_of_a_paused_transfer_drops_it_from_the_queue(arr_app):
    row, nzo = await _downloading(arr_app)
    await _pause(arr_app, row)
    arr_app.telegram.release_downloads()
    await asyncio.sleep(SETTLE_S)

    await arr_app.sab(mode="queue", name="delete", value=nzo)

    assert (await arr_app.sab(mode="queue"))["queue"]["slots"] == []
    assert (await arr_app.download(FILE))["status"] == "cancelled"


@pytest.mark.asyncio
@pytest.mark.parametrize("winding_down", [False, True], ids=["stopped", "still-winding-down"])
async def test_cancelling_a_paused_transfer_cancels_it_for_good(arr_app, winding_down):
    hold = {"late_outcome": asyncio.CancelledError} if winding_down else {}
    row, _ = await _downloading(arr_app, **hold)
    await _pause(arr_app, row)
    if not winding_down:
        await asyncio.sleep(SETTLE_S)

    cancel = (await arr_app.http.post(f"/api/downloads/{row['id']}/cancel")).raise_for_status().json()
    arr_app.telegram.release_downloads()
    await asyncio.sleep(SETTLE_S)

    assert cancel == {"ok": True}
    assert (await arr_app.download(FILE))["status"] == "cancelled"


@pytest.mark.asyncio
async def test_a_transfer_that_errors_while_winding_down_stays_paused(arr_app, library_dirs):
    row, _ = await _downloading(arr_app, partial=True, late_outcome=RuntimeError)
    await _pause(arr_app, row)

    arr_app.telegram.release_downloads()
    await asyncio.sleep(SETTLE_S)

    assert (await arr_app.download(FILE))["status"] == "paused"
    assert _files_named(library_dirs["DOWNLOADS_DIR"], FILE) == []


@pytest.mark.asyncio
async def test_a_file_that_lands_while_pausing_stays_paused_and_a_resume_finishes_it(arr_app):
    row, _ = await _downloading(arr_app, finish_despite_cancel=True)
    await _pause(arr_app, row)

    arr_app.telegram.release_downloads()
    await asyncio.sleep(SETTLE_S)
    status = (await arr_app.download(FILE))["status"]
    await _resume(arr_app, row)
    await eventually(lambda: _in_status(arr_app, "completed"))

    assert status == "paused"
    assert arr_app.telegram.downloaded == [(CHAT, 1)]   # not fetched a second time


@pytest.mark.asyncio
@pytest.mark.parametrize("late_outcome", [asyncio.CancelledError, RuntimeError],
                         ids=["stops-as-cancelled", "stops-with-an-error"])
async def test_a_resume_while_the_paused_transfer_winds_down_still_downloads_it(
        arr_app, late_outcome):
    row, _ = await _downloading(arr_app, late_outcome=late_outcome)
    await _pause(arr_app, row)

    resumed = await _resume(arr_app, row)
    arr_app.telegram.release_downloads()

    assert resumed == {"ok": True}
    await eventually(lambda: _in_status(arr_app, "completed"))


@pytest.mark.asyncio
async def test_pausing_a_resumed_transfer_while_the_old_run_winds_down_holds_it(arr_app):
    row, _ = await _downloading(arr_app, late_outcome=asyncio.CancelledError)
    await _pause(arr_app, row)
    await _resume(arr_app, row)
    await asyncio.sleep(SETTLE_S)   # the new run is waiting on the old one

    repaused = await _pause(arr_app, row)
    arr_app.telegram.release_downloads()
    await asyncio.sleep(SETTLE_S)

    assert repaused == {"ok": True}
    assert (await arr_app.download(FILE))["status"] == "paused"
    assert arr_app.telegram.downloaded == []


@pytest.mark.asyncio
async def test_a_re_grab_of_a_paused_transfer_leaves_it_paused(arr_app):
    [url] = await arr_app.publish_episodes(CHAT, "The Show", 1)
    arr_app.telegram.hold_downloads()
    nzo = await arr_app.grab(url)
    row = await eventually(lambda: _in_status(arr_app, "downloading"))
    await _pause(arr_app, row)
    arr_app.telegram.release_downloads()
    await asyncio.sleep(SETTLE_S)

    again = await arr_app.grab(url)
    await asyncio.sleep(SETTLE_S)

    assert again == nzo
    assert (await arr_app.download(FILE))["status"] == "paused"
    assert arr_app.telegram.downloaded == []


@pytest.mark.asyncio
async def test_status_counts_paused_transfers(arr_app):
    row, _ = await _downloading(arr_app)
    await _pause(arr_app, row)
    arr_app.telegram.release_downloads()
    await asyncio.sleep(SETTLE_S)

    stats = (await arr_app.http.get("/api/status")).raise_for_status().json()["stats"]

    assert (stats["paused"], stats["queued"], stats["downloading"]) == (1, 0, 0)


@pytest.mark.asyncio
async def test_a_scan_does_not_replace_a_paused_episode_with_another_post_of_it(arr_app):
    (await arr_app.http.patch("/api/settings", json={"operating_mode": "standalone"})).raise_for_status()
    arr_app.telegram.add_channel(CHAT, "The Show")
    arr_app.post_episodes(CHAT, "The Show", [1])
    arr_app.telegram.hold_downloads()
    channel = await arr_app.add_channel(CHAT)
    await arr_app.scan(channel["id"])
    row = await eventually(lambda: _in_status(arr_app, "downloading"))
    await _pause(arr_app, row)
    arr_app.telegram.release_downloads()
    await asyncio.sleep(SETTLE_S)
    arr_app.post_episodes(CHAT, "The Show", [1])

    (await arr_app.http.post(f"/api/channels/{channel['id']}/scan")).raise_for_status()
    await asyncio.sleep(SETTLE_S)

    assert [d["status"] for d in (await arr_app.http.get("/api/downloads")).json()] == ["paused"]
    assert arr_app.telegram.downloaded == []
