"""End-to-end: drive Telegrarr over HTTP exactly as Sonarr/Radarr do.

Uses the ``arr_app`` harness (tests/http_harness.py): a real ASGI app on a temp
DB, authenticated, with only the Telegram client and library paths substituted.
"""
import xml.etree.ElementTree as ET

import pytest


@pytest.mark.asyncio
async def test_caps_lists_tv_and_movie_categories(arr_app):
    r = await arr_app.http.get("/api/newznab", params={"t": "caps"})

    assert r.status_code == 200
    assert 'category id="5000" name="TV"' in r.text
    assert 'category id="2000" name="Movies"' in r.text


CHAT_ID = -1001234567890


@pytest.mark.asyncio
async def test_tvsearch_returns_release_built_from_fake_message(arr_app):
    arr_app.telegram.add_channel(CHAT_ID, "The Show")
    arr_app.telegram.post(CHAT_ID, text="The Show S01E02 1080p", file_name="The.Show.S01E02.1080p.mkv")
    channel = await arr_app.add_channel(CHAT_ID, kind="tv")
    await arr_app.scan(channel["id"])

    r = await arr_app.http.get("/api/newznab", params={
        "t": "tvsearch", "apikey": arr_app.apikey, "q": "the show", "season": "1", "ep": "2"})

    assert r.status_code == 200
    assert "<title>The.Show.S01E02.CAT.1080p.WEB-DL.x264-TELEGRARR</title>" in r.text
    assert f"/api/newznab/nzb?id={channel['id']}_1" in r.text


def _enclosure_url(feed_xml: str) -> str:
    root = ET.fromstring(feed_xml)
    return root.find("./channel/item/enclosure").attrib["url"]


@pytest.mark.asyncio
async def test_sab_grab_goes_through_queue_to_completed_history(arr_app):
    content = b"episode-bytes" * 100
    arr_app.telegram.add_channel(CHAT_ID, "The Show")
    arr_app.telegram.post(CHAT_ID, text="The Show S01E02 1080p", file_name="The.Show.S01E02.1080p.mkv",
                          content=content)
    channel = await arr_app.add_channel(CHAT_ID, kind="tv")
    arr_app.telegram.hold_downloads()
    await arr_app.scan(channel["id"])
    feed = await arr_app.http.get("/api/newznab", params={"t": "tvsearch", "apikey": arr_app.apikey, "q": "the show"})
    sab = {"apikey": arr_app.apikey, "output": "json"}

    added = (await arr_app.http.get("/sabnzbd/api", params={
        **sab, "mode": "addurl", "name": _enclosure_url(feed.text), "cat": "tv"})).json()
    queue = (await arr_app.http.get("/sabnzbd/api", params={**sab, "mode": "queue"})).json()
    arr_app.telegram.release_downloads()
    slot = await arr_app.history_slot(added["nzo_ids"][0])

    assert added["status"] is True
    assert [s["nzo_id"] for s in queue["queue"]["slots"]] == added["nzo_ids"]
    assert slot["status"] == "Completed"
    with open(slot["storage"], "rb") as fh:
        assert fh.read() == content
