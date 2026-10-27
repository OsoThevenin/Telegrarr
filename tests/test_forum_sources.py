"""Forum groups as sources (#23), driven over HTTP as Sonarr/Radarr and the UI do.

A forum group added as a whole chat (no topic) behaves exactly as a channel
always has: scans and directory scans read every topic's messages.
"""
import xml.etree.ElementTree as ET

import pytest

FORUM = -1007100000001
MERLI = -1007100000002


@pytest.fixture(autouse=True)
def _isolated_directory_scans(monkeypatch):
    """Directory resolutions are spaced out for account safety; tests don't wait.
    Each test starts with no cached scans and an open FloodWait gate."""
    from app import directory, downloader
    from app.safety import FloodGate

    monkeypatch.setattr(directory, "RESOLVE_INTERVAL_S", 0)
    directory.forget_scans()
    monkeypatch.setattr(downloader, "flood_gate", FloodGate())


def _titles(feed_xml: str) -> set[str]:
    return {i.find("title").text for i in ET.fromstring(feed_xml).findall("./channel/item")}


@pytest.mark.asyncio
async def test_whole_forum_source_indexes_posts_from_every_topic_and_general(arr_app):
    tg = arr_app.telegram
    forum = tg.add_forum(FORUM, "The Show", topics=("Sèries HD", "Novetats"))
    tg.post(FORUM, text="The Show S01E01 1080p", file_name="The.Show.S01E01.mkv",
            topic=forum.topic_id("Sèries HD"))
    tg.post(FORUM, text="The Show S01E02 1080p", file_name="The.Show.S01E02.mkv",
            topic=forum.topic_id("Novetats"))
    tg.post(FORUM, text="The Show S01E03 1080p", file_name="The.Show.S01E03.mkv")
    channel = await arr_app.add_channel(FORUM, kind="tv")

    await arr_app.scan(channel["id"])

    r = await arr_app.http.get("/api/newznab", params={"t": "tvsearch", "apikey": arr_app.apikey,
                                                      "q": "the show"})
    assert {t.split(".CAT.")[0] for t in _titles(r.raise_for_status().text)} == {
        "The.Show.S01E01", "The.Show.S01E02", "The.Show.S01E03"}


@pytest.mark.asyncio
async def test_directory_scan_of_a_whole_forum_lists_links_from_every_topic(arr_app):
    tg = arr_app.telegram
    forum = tg.add_forum(FORUM, "Anime en català", topics=("Sèries HD",))
    tg.add_channel(MERLI, "Merlí [CAT] 1080p", username="merli_cat")
    tg.post_text(FORUM, "Merlí: https://t.me/merli_cat", topic=forum.topic_id("Sèries HD"))
    tg.post_text(FORUM, "Missing: https://t.me/no_such_cat")

    r = await arr_app.http.post("/api/directory/scan", json={"chat_id": FORUM})

    links = {e["link"]: e for e in r.raise_for_status().json()["links"]}
    assert set(links) == {"https://t.me/merli_cat", "https://t.me/no_such_cat"}
    assert links["https://t.me/merli_cat"]["chat_id"] == MERLI


async def _listed(arr_app) -> list[dict]:
    return (await arr_app.http.get("/api/channels")).raise_for_status().json()


@pytest.mark.asyncio
async def test_a_topic_source_is_stored_and_listed_with_its_topic(arr_app):
    forum = arr_app.telegram.add_forum(FORUM, "Anime en català", topics=("Pel·lícules HD",))
    tid = forum.topic_id("Pel·lícules HD")

    added = await arr_app.add_channel(FORUM, kind="movie", topic_id=tid, topic_title="Pel·lícules HD")

    [row] = await _listed(arr_app)
    assert row["id"] == added["id"]
    assert (row["chat_id"], row["topic_id"], row["topic_title"]) == (FORUM, tid, "Pel·lícules HD")
    assert row["title"] == "Anime en català"
