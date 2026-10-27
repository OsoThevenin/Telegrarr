"""A second message for an episode that is already downloading is resolved,
not left ``queued`` forever with no task behind it.

Driven over HTTP (``arr_app``): Sonarr grabs through the SABnzbd shim and the
UI reads ``/api/downloads``. The fake Telegram holds transfers so the first
row stays ``downloading`` while the second one is grabbed.
"""
import asyncio
import json
import urllib.parse
from pathlib import Path

import pytest

from app import i18n
from http_harness import eventually

I18N_DIR = Path(__file__).resolve().parent.parent / "app" / "static" / "i18n"

CHAT = -1001000000034
FILE = "The.Show.S01E01.mkv"
OTHER_FILE = "The.Show.S01E01.720p.mkv"
DUPLICATE_REASON = "dl.err.duplicate"
SETTLE_S = 0.2   # time for a duplicate task to (wrongly) touch the running row


def _with_message(url: str, message_id: int) -> str:
    """``url`` (an NZB grab link) pointing at ``message_id`` in the same channel."""
    parts = urllib.parse.urlparse(url)
    query = urllib.parse.parse_qs(parts.query)
    channel_id = query["id"][0].split("_")[0]
    query["id"] = [f"{channel_id}_{message_id}"]
    return parts._replace(query=urllib.parse.urlencode(query, doseq=True)).geturl()


async def _row_in(arr_app, file_name: str, status: str) -> dict | None:
    row = await arr_app.download(file_name)
    return row if row and row["status"] == status else None


async def _queue_ids(arr_app) -> list[str]:
    slots = (await arr_app.sab(mode="queue"))["queue"]["slots"]
    return [s["nzo_id"] for s in slots]


@pytest.mark.asyncio
async def test_second_message_for_a_downloading_episode_does_not_stay_queued(arr_app):
    [url] = await arr_app.publish_episodes(CHAT, "The Show", 1)
    other = arr_app.telegram.post(CHAT, text="The Show S01E01 720p", file_name=OTHER_FILE)
    arr_app.telegram.hold_downloads()
    await arr_app.sab(mode="addurl", name=url, cat="tv")
    await eventually(lambda: _row_in(arr_app, FILE, "downloading"))

    added = await arr_app.sab(mode="addurl", name=_with_message(url, other.id), cat="tv")
    duplicate = await eventually(lambda: _row_in(arr_app, OTHER_FILE, "cancelled"))
    queue = await _queue_ids(arr_app)
    arr_app.telegram.release_downloads()
    await eventually(lambda: _row_in(arr_app, FILE, "completed"))

    assert duplicate["error_msg"] == {"key": DUPLICATE_REASON, "params": {}}
    assert added["nzo_ids"][0] not in queue


@pytest.mark.asyncio
async def test_duplicate_task_for_the_in_flight_row_leaves_it_unchanged(arr_app):
    [url] = await arr_app.publish_episodes(CHAT, "The Show", 1)
    arr_app.telegram.hold_downloads()
    await arr_app.sab(mode="addurl", name=url, cat="tv")
    running = await eventually(lambda: _row_in(arr_app, FILE, "downloading"))

    await arr_app.sab(mode="addurl", name=url, cat="tv")   # a second task for the same row
    await asyncio.sleep(SETTLE_S)
    after = await arr_app.download(FILE)
    arr_app.telegram.release_downloads()
    await eventually(lambda: _row_in(arr_app, FILE, "completed"))

    assert (after["status"], after["progress"], after["error_msg"]) == \
        (running["status"], running["progress"], running["error_msg"])


@pytest.mark.parametrize("lang", i18n.LANGS)
def test_duplicate_reason_is_translated_in_every_shipped_language(lang):
    catalog = json.loads((I18N_DIR / f"{lang}.json").read_text(encoding="utf-8"))

    assert catalog.get(DUPLICATE_REASON)
