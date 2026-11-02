"""A backlog of unimported Grabs must not hide other finished ones (#83).

SABnzbd history used to report only the 100 newest rows by id, so a show whose
Grabs piled up unimported pushed older-by-id Grabs of other shows out of
Sonarr's sight. Every finished row the *arr hasn't deleted is now reported, and
Sonarr's ``start``/``limit`` paging is ignored. Driven over HTTP (``arr_app``).
"""
import pytest

from http_harness import eventually

BACKLOG_CHAT = -1001000000083
OTHER_CHAT = -1001000000084
BACKLOG_SHOW = "Backlog Show"
BACKLOG_SIZE = 101          # one more than the old history window
SCAN_BATCH = 60             # posts per scan, under the scanner's per-scan read cap
SONARR_DEFAULT_LIMIT = 60
DOWNLOADS_PAGE = 1000       # the UI's downloads list caps its page here


async def _episode_urls(arr_app, chat_id: int, show: str, count: int) -> list[str]:
    """Post ``count`` episodes of ``show`` on a new channel, scanning after each
    batch, and return their NZB urls."""
    arr_app.telegram.add_channel(chat_id, show)
    channel = None
    for first in range(1, count + 1, SCAN_BATCH):
        last = min(first + SCAN_BATCH, count + 1) - 1
        arr_app.post_episodes(chat_id, show, range(first, last + 1))
        channel = channel or await arr_app.add_channel(chat_id)
        await arr_app.scan(channel["id"])
        await arr_app.episode_url(show, last)
    return [await arr_app.episode_url(show, ep) for ep in range(1, count + 1)]


async def _pile_up_a_backlog(arr_app) -> list[str]:
    """More completed, never-imported grabs on one channel than the old window
    held; returns their nzo_ids."""
    urls = await _episode_urls(arr_app, BACKLOG_CHAT, BACKLOG_SHOW, BACKLOG_SIZE)
    nzos = [await arr_app.grab(url) for url in urls]
    prefix = BACKLOG_SHOW.replace(" ", ".")

    async def all_finished():
        r = await arr_app.http.get("/api/downloads",
                                   params={"status": "completed", "limit": DOWNLOADS_PAGE})
        done = [d for d in r.raise_for_status().json() if d["file_name"].startswith(prefix)]
        return len(done) == BACKLOG_SIZE
    await eventually(all_finished)
    return nzos


@pytest.mark.asyncio
async def test_a_completed_grab_with_a_lower_id_stays_visible_behind_a_backlog(arr_app):
    [url] = await arr_app.publish_episodes(OTHER_CHAT, "Other Show", 1)
    other = await arr_app.grab(url)
    assert (await arr_app.history_slot(other))["status"] == "Completed"

    await _pile_up_a_backlog(arr_app)

    assert other in await arr_app.history_ids()


@pytest.mark.asyncio
async def test_a_failed_grab_with_a_lower_id_stays_visible_behind_a_backlog(arr_app):
    [url] = await arr_app.publish_episodes(OTHER_CHAT, "Other Show", 1)
    arr_app.telegram.channels[OTHER_CHAT].payloads.pop(1)      # the download will fail
    other = await arr_app.grab(url)
    assert (await arr_app.history_slot(other))["status"] == "Failed"

    await _pile_up_a_backlog(arr_app)

    assert other in await arr_app.history_ids()


@pytest.mark.asyncio
async def test_sonarr_paging_does_not_narrow_the_history(arr_app):
    [url] = await arr_app.publish_episodes(OTHER_CHAT, "Other Show", 1)
    other = await arr_app.grab(url)
    await arr_app.history_slot(other)
    backlog = await _pile_up_a_backlog(arr_app)

    first_page = await arr_app.history_ids(start=0, limit=SONARR_DEFAULT_LIMIT)
    second_page = await arr_app.history_ids(start=SONARR_DEFAULT_LIMIT, limit=SONARR_DEFAULT_LIMIT)

    assert set(first_page) == {other, *backlog}
    assert second_page == first_page


@pytest.mark.asyncio
async def test_rows_sonarr_deleted_stay_hidden_behind_a_backlog(arr_app):
    [url] = await arr_app.publish_episodes(OTHER_CHAT, "Other Show", 1)
    imported = await arr_app.grab(url)
    await arr_app.history_slot(imported)
    await arr_app.sab(mode="history", name="delete", value=imported)

    backlog = await _pile_up_a_backlog(arr_app)

    history = await arr_app.history_ids()
    assert imported not in history
    assert set(backlog) <= set(history)
