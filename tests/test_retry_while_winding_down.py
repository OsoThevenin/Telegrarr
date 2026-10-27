"""A Retry right after a cancel is honoured even while the cancelled transfer
is still winding down: the old attempt neither swallows the new one (leaving
the row queued with no task behind it) nor overwrites its status (#30).

Driven over HTTP (``arr_app``): Sonarr grabs and deletes through the SABnzbd
shim, the UI retries through ``/api/downloads``. The fake Telegram holds the
transfer and makes it give up on the cancel only once released.
"""
import asyncio

import pytest

from http_harness import eventually

CHAT = -1001000000030
FILE = "The.Show.S01E01.mkv"


async def _status(arr_app, status: str) -> dict | None:
    row = await arr_app.download(FILE)
    return row if row and row["status"] == status else None


@pytest.mark.asyncio
@pytest.mark.parametrize("late_outcome", [asyncio.CancelledError, RuntimeError],
                         ids=["stops-as-cancelled", "stops-with-an-error"])
async def test_retry_while_the_cancelled_transfer_winds_down_downloads_the_new_attempt(
        arr_app, late_outcome):
    [url] = await arr_app.publish_episodes(CHAT, "The Show", 1)
    arr_app.telegram.hold_downloads(late_outcome=late_outcome)
    [nzo] = (await arr_app.sab(mode="addurl", name=url, cat="tv"))["nzo_ids"]
    row = await eventually(lambda: _status(arr_app, "downloading"))
    await arr_app.sab(mode="queue", name="delete", value=nzo)
    await eventually(lambda: _status(arr_app, "cancelled"))

    r = await arr_app.http.post(f"/api/downloads/{row['id']}/retry")
    arr_app.telegram.release_downloads()

    assert r.raise_for_status().json() == {"ok": True}
    await eventually(lambda: _status(arr_app, "completed"))
