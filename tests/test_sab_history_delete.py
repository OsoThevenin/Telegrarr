"""Sonarr/Radarr deleting an item from SABnzbd history (#33).

A delete of a finished row hides it from the history Telegrarr reports, so the
*arr stops re-sending it every poll. The row stays in Telegrarr's own Downloads
view and its files are never touched. Driven over HTTP (``arr_app``).
"""
import os

import pytest

from http_harness import eventually

CHAT = -1001000000033
FILE = "The.Show.S01E01.mkv"


async def _history_ids(arr_app) -> list[str]:
    return [s["nzo_id"] for s in (await arr_app.sab(mode="history"))["history"]["slots"]]


async def _row_with_status(arr_app, status: str):
    async def probe():
        row = await arr_app.download(FILE)
        return row if row and row["status"] == status else None
    return await eventually(probe)


@pytest.mark.asyncio
async def test_history_delete_of_a_failed_row_hides_it_but_keeps_the_row(arr_app):
    [url] = await arr_app.publish_episodes(CHAT, "The Show", 1)
    arr_app.telegram.channels[CHAT].payloads.pop(1)          # the download will fail
    [nzo] = (await arr_app.sab(mode="addurl", name=url, cat="tv"))["nzo_ids"]
    assert (await arr_app.history_slot(nzo))["status"] == "Failed"

    deleted = await arr_app.sab(mode="history", name="delete", value=nzo, del_files=1)

    assert deleted["status"] is True
    assert nzo not in await _history_ids(arr_app)
    assert (await arr_app.download(FILE))["status"] == "failed"


@pytest.mark.asyncio
async def test_history_delete_of_a_completed_row_with_del_files_keeps_the_file(arr_app):
    [url] = await arr_app.publish_episodes(CHAT, "The Show", 1)
    [nzo] = (await arr_app.sab(mode="addurl", name=url, cat="tv"))["nzo_ids"]
    slot = await arr_app.history_slot(nzo)
    path = os.path.join(slot["storage"], FILE)
    assert slot["status"] == "Completed" and os.path.exists(path)

    await arr_app.sab(mode="history", name="delete", value=nzo, del_files=1)

    assert nzo not in await _history_ids(arr_app)
    assert (await arr_app.download(FILE))["status"] == "completed"
    assert os.path.exists(path)


@pytest.mark.asyncio
async def test_history_delete_of_a_downloading_row_still_cancels_it(arr_app):
    [url] = await arr_app.publish_episodes(CHAT, "The Show", 1)
    arr_app.telegram.hold_downloads()
    [nzo] = (await arr_app.sab(mode="addurl", name=url, cat="tv"))["nzo_ids"]
    await _row_with_status(arr_app, "downloading")

    await arr_app.sab(mode="history", name="delete", value=nzo)
    cancelled = await _row_with_status(arr_app, "cancelled")
    arr_app.telegram.release_downloads()

    assert cancelled["status"] == "cancelled"
    assert nzo not in [s["nzo_id"] for s in (await arr_app.sab(mode="queue"))["queue"]["slots"]]
