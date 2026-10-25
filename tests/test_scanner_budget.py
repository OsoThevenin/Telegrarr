"""Downloads pause (stay queued, with a visible reason) while the daily budget is used up.

Driven over HTTP (``arr_app``): Sonarr grabs through the SABnzbd shim; the UI
sets the budget in Settings and reads ``/api/downloads`` and ``/api/status``.
"""
import pytest

from app import scanner
from http_harness import eventually

CHAT = -1001000000078
FILE_SIZE = 1024                         # FakeTelegram's default payload
ONE_FILE_BUDGET_GB = 0.0000005           # ~537 bytes: one grab uses it up
FIRST, SECOND = "The.Show.S01E01.mkv", "The.Show.S01E02.mkv"


@pytest.fixture()
def fast_recheck(monkeypatch):
    monkeypatch.setattr(scanner, "BUDGET_RECHECK_SECONDS", 0.01)


async def _set_budget(arr_app, gb: float) -> None:
    (await arr_app.http.patch("/api/settings", json={"daily_budget_gb": gb})).raise_for_status()


async def _grab_one_then_another(arr_app) -> None:
    """Grab E01 to completion under a one-file budget, then grab E02."""
    await _set_budget(arr_app, ONE_FILE_BUDGET_GB)
    first, second = await arr_app.publish_episodes(CHAT, "The Show", 1, 2)
    await arr_app.history_slot((await arr_app.sab(mode="addurl", name=first, cat="tv"))["nzo_ids"][0])
    await arr_app.sab(mode="addurl", name=second, cat="tv")


async def _held(arr_app) -> dict | None:
    row = await arr_app.download(SECOND)
    return row if row and row["error_msg"] else None


async def _completed(arr_app) -> dict | None:
    row = await arr_app.download(SECOND)
    return row if row and row["status"] == "completed" else None


@pytest.mark.asyncio
async def test_exhausted_budget_keeps_download_queued_with_reason(arr_app, fast_recheck):
    await _grab_one_then_another(arr_app)

    held = await eventually(lambda: _held(arr_app))
    served = [mid for _, mid in arr_app.telegram.downloaded]
    await _set_budget(arr_app, 0)

    assert held["status"] == "queued"
    assert held["error_msg"]["key"] == "budget.download_held"
    assert set(held["error_msg"]["params"]) == {"resets"}
    assert served == [1]                 # E02 never fetched from Telegram while held


@pytest.mark.asyncio
async def test_download_resumes_when_budget_frees_up(arr_app, fast_recheck):
    await _grab_one_then_another(arr_app)
    await eventually(lambda: _held(arr_app))

    await _set_budget(arr_app, 0)        # as if the day rolled over / limit lifted
    done = await eventually(lambda: _completed(arr_app))

    assert done["error"] is None and done["error_msg"] is None
    assert [mid for _, mid in arr_app.telegram.downloaded] == [1, 2]


@pytest.mark.asyncio
async def test_completed_download_counts_toward_budget(arr_app):
    [url] = await arr_app.publish_episodes(CHAT, "The Show", 1)

    await arr_app.history_slot((await arr_app.sab(mode="addurl", name=url, cat="tv"))["nzo_ids"][0])

    status = (await arr_app.http.get("/api/status")).raise_for_status().json()
    assert status["budget"]["used_bytes"] == FILE_SIZE
