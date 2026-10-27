"""Retry re-queues only stopped downloads (failed or cancelled); a queued or
downloading row is left untouched, singly or in bulk (#31).

Driven over HTTP (``arr_app``): Sonarr grabs through the SABnzbd shim, the UI
retries through ``/api/downloads``.
"""
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
