"""Retry re-queues only stopped downloads (failed or cancelled); a queued or
downloading row is left untouched, singly or in bulk (#31).

Driven over HTTP (``arr_app``): Sonarr grabs through the SABnzbd shim, the UI
retries through ``/api/downloads``.
"""
import json
import shutil
import subprocess

import pytest

from http_harness import eventually

CHAT = -1001000000031
FILE_1 = "The.Show.S01E01.mkv"
FILE_2 = "The.Show.S01E02.mkv"


async def _status(arr_app, file_name: str, status: str) -> dict | None:
    row = await arr_app.download(file_name)
    return row if row and row["status"] == status else None


async def _grab_held(arr_app, *episodes: int) -> list[dict]:
    """Grab ``episodes`` with transfers held; return their rows once downloading."""
    urls = await arr_app.publish_episodes(CHAT, "The Show", *episodes)
    arr_app.telegram.hold_downloads()
    for url in urls:
        await arr_app.sab(mode="addurl", name=url, cat="tv")
    return [await eventually(lambda f=f"The.Show.S01E{ep:02d}.mkv": _status(arr_app, f, "downloading"))
            for ep in episodes]


@pytest.mark.asyncio
async def test_retrying_a_downloading_row_leaves_it_downloading(arr_app):
    [before] = await _grab_held(arr_app, 1)

    r = await arr_app.http.post(f"/api/downloads/{before['id']}/retry")
    after = await arr_app.download(FILE_1)

    assert r.raise_for_status().json() == {"ok": False}
    assert (after["status"], after["progress"], after["started_at"]) == \
        ("downloading", before["progress"], before["started_at"])
    arr_app.telegram.release_downloads()
    await eventually(lambda: _status(arr_app, FILE_1, "completed"))


async def _grab_failed(arr_app, url: str, episode: int) -> tuple[dict, bytes]:
    """Grab ``url`` while episode ``episode``'s file can't be fetched; return the
    failed row and the payload to put back so a retry can succeed."""
    channel = arr_app.telegram.channels[CHAT]
    mid = next(m.id for m in channel.messages.values() if f"S01E{episode:02d}" in m.message)
    payload = channel.payloads.pop(mid)
    await arr_app.sab(mode="addurl", name=url, cat="tv")
    failed = await eventually(lambda: _status(arr_app, f"The.Show.S01E{episode:02d}.mkv", "failed"))
    return failed, payload


def _restore(arr_app, row: dict, payload: bytes) -> None:
    arr_app.telegram.channels[CHAT].payloads[row["message_id"]] = payload


@pytest.mark.asyncio
async def test_bulk_retry_re_queues_only_the_failed_row(arr_app):
    url_1, url_2 = await arr_app.publish_episodes(CHAT, "The Show", 1, 2)
    failed, payload = await _grab_failed(arr_app, url_1, 1)
    _restore(arr_app, failed, payload)
    arr_app.telegram.hold_downloads()
    await arr_app.sab(mode="addurl", name=url_2, cat="tv")
    downloading = await eventually(lambda: _status(arr_app, FILE_2, "downloading"))

    r = await arr_app.http.post("/api/downloads/bulk",
                                json={"action": "retry", "ids": [failed["id"], downloading["id"]]})

    assert r.raise_for_status().json() == {"ok": True, "count": 1}
    after = await arr_app.download(FILE_2)
    assert (after["status"], after["progress"], after["started_at"]) == \
        ("downloading", downloading["progress"], downloading["started_at"])
    assert (await arr_app.download(FILE_1))["status"] in ("queued", "downloading")
    arr_app.telegram.release_downloads()
    await eventually(lambda: _status(arr_app, FILE_1, "completed"))
    await eventually(lambda: _status(arr_app, FILE_2, "completed"))


@pytest.mark.asyncio
async def test_retrying_a_failed_row_downloads_it_to_completion(arr_app):
    [url] = await arr_app.publish_episodes(CHAT, "The Show", 1)
    failed, payload = await _grab_failed(arr_app, url, 1)
    _restore(arr_app, failed, payload)

    r = await arr_app.http.post(f"/api/downloads/{failed['id']}/retry")

    assert r.raise_for_status().json() == {"ok": True}
    await eventually(lambda: _status(arr_app, FILE_1, "completed"))


@pytest.mark.asyncio
async def test_retrying_a_cancelled_row_re_queues_it(arr_app):
    [held] = await _grab_held(arr_app, 1)
    (await arr_app.http.post(f"/api/downloads/{held['id']}/cancel")).raise_for_status()
    await eventually(lambda: _status(arr_app, FILE_1, "cancelled"))

    r = await arr_app.http.post(f"/api/downloads/{held['id']}/retry")

    assert r.raise_for_status().json() == {"ok": True}
    assert (await arr_app.download(FILE_1))["status"] in ("queued", "downloading")
    arr_app.telegram.release_downloads()
    await eventually(lambda: _status(arr_app, FILE_1, "completed"))


# ── the Downloads view's bulk Retry ──────────────────────────────────
def _run_module(source: str, expression: str):
    """Evaluate ``expression`` against the ES module ``source`` in node; return its JSON value."""
    script = (f"const m = await import('data:text/javascript,' + encodeURIComponent({json.dumps(source)}));"
              f"console.log(JSON.stringify({expression}));")
    out = subprocess.run(["node", "--input-type=module", "-e", script],
                         capture_output=True, text=True, check=True, timeout=30)
    return json.loads(out.stdout)


@pytest.mark.asyncio
@pytest.mark.skipif(shutil.which("node") is None, reason="needs node to run the UI module")
async def test_bulk_retry_in_the_ui_sends_only_failed_or_cancelled_ids(arr_app):
    module = (await arr_app.http.get("/static/js/retry.js")).raise_for_status().text
    views = (await arr_app.http.get("/static/js/views.js")).raise_for_status().text
    selection = [{"id": 1, "status": "failed"}, {"id": 2, "status": "downloading"},
                 {"id": 3, "status": "cancelled"}, {"id": 4, "status": "queued"},
                 {"id": 5, "status": "completed"}]

    ids = _run_module(module, f"m.retryableIds({json.dumps(selection)})")

    assert ids == [1, 3]
    assert 'from "./retry.js"' in views
