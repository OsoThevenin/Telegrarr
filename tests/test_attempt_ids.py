"""Each new attempt at a stopped download gets a fresh SABnzbd download id (#35).

Sonarr/Radarr write off an id they saw fail, so a re-grab or retry must be
reported under a new id. Attempt 0 keeps the legacy ``telearr<id>`` form.
Driven over HTTP (``arr_app``).
"""
import pytest

from http_harness import eventually

CHAT = -1001000000035
FILE = "The.Show.S01E01.mkv"


async def _status(arr_app, status: str) -> dict | None:
    row = await arr_app.download(FILE)
    return row if row and row["status"] == status else None


async def _queue_ids(arr_app) -> list[str]:
    return [s["nzo_id"] for s in (await arr_app.sab(mode="queue"))["queue"]["slots"]]


async def _history_ids(arr_app) -> list[str]:
    return [s["nzo_id"] for s in (await arr_app.sab(mode="history"))["history"]["slots"]]


async def _grab(arr_app, url: str) -> str:
    [nzo] = (await arr_app.sab(mode="addurl", name=url, cat="tv"))["nzo_ids"]
    return nzo


async def _grab_failed(arr_app) -> tuple[str, str, bytes]:
    """Grab episode 1 while its file can't be fetched; return its url, the failed
    attempt's id, and the payload to put back so a new attempt can succeed."""
    [url] = await arr_app.publish_episodes(CHAT, "The Show", 1)
    payload = arr_app.telegram.channels[CHAT].payloads.pop(1)
    nzo = await _grab(arr_app, url)
    assert (await arr_app.history_slot(nzo))["status"] == "Failed"
    return url, nzo, payload


def _restore(arr_app, payload: bytes) -> None:
    arr_app.telegram.channels[CHAT].payloads[1] = payload


@pytest.mark.asyncio
async def test_a_re_grab_of_a_failed_download_is_tracked_under_a_new_id(arr_app):
    url, old, payload = await _grab_failed(arr_app)
    _restore(arr_app, payload)
    arr_app.telegram.hold_downloads()

    new = await _grab(arr_app, url)
    await eventually(lambda: _status(arr_app, "downloading"))
    queue = await _queue_ids(arr_app)
    arr_app.telegram.release_downloads()
    slot = await arr_app.history_slot(new)

    assert new != old
    assert queue == [new]
    assert slot["status"] == "Completed"
