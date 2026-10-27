"""A forum group's General topic as a source (#27), driven over HTTP.

Telegram can't read General through the topic filter, so a General source reads
the whole group and keeps only the messages that belong to no named topic.
"""
import xml.etree.ElementTree as ET

import pytest

from http_harness import GENERAL_TOPIC_ID, GENERAL_TOPIC_TITLE, eventually

FORUM = -1007200000001


@pytest.fixture(autouse=True)
def _isolated_scans(monkeypatch):
    """Each test starts with an open FloodWait gate."""
    from app import downloader
    from app.safety import FloodGate

    monkeypatch.setattr(downloader, "flood_gate", FloodGate())


async def _episodes(arr_app) -> set[str]:
    """The episodes Sonarr finds for "the show" (release names without their tail)."""
    r = await arr_app.http.get("/api/newznab", params={"t": "tvsearch", "apikey": arr_app.apikey,
                                                      "q": "the show"})
    items = ET.fromstring(r.raise_for_status().text).findall("./channel/item")
    return {i.find("title").text.split(".CAT.")[0] for i in items}


def _episode(n: int) -> dict:
    return dict(text=f"The Show S01E0{n} 1080p", file_name=f"The.Show.S01E0{n}.mkv")


def _forum_with_posts(tg):
    """A forum where E01 and E02 sit in General, and E03 and E04 in the named topic "Sèries HD".

    E02 and E04 are replies (to E01 and E03), which Telegram marks differently
    from top-level posts."""
    forum = tg.add_forum(FORUM, "The Show", topics=("Sèries HD", "Novetats"))
    series = forum.topic_id("Sèries HD")
    e01 = tg.post(FORUM, **_episode(1))
    tg.post(FORUM, **_episode(2), reply_to=e01.id)
    e03 = tg.post(FORUM, **_episode(3), topic=series)
    tg.post(FORUM, **_episode(4), topic=series, reply_to=e03.id)
    tg.post_text(FORUM, "Benvinguts!")
    return forum


async def _general_source(arr_app) -> dict:
    return await arr_app.add_channel(FORUM, kind="tv", topic_id=GENERAL_TOPIC_ID,
                                     topic_title=GENERAL_TOPIC_TITLE)


@pytest.mark.asyncio
async def test_general_can_be_added_and_listed_like_any_other_topic(arr_app):
    arr_app.telegram.add_forum(FORUM, "The Show", topics=("Sèries HD",))

    added = await _general_source(arr_app)

    [row] = (await arr_app.http.get("/api/channels")).raise_for_status().json()
    assert row["id"] == added["id"]
    assert (row["chat_id"], row["topic_id"], row["topic_title"]) == (FORUM, 1, "General")


@pytest.mark.asyncio
async def test_a_general_source_scan_indexes_only_files_outside_named_topics(arr_app):
    _forum_with_posts(arr_app.telegram)
    source = await _general_source(arr_app)

    await arr_app.scan(source["id"])

    assert await _episodes(arr_app) == {"The.Show.S01E01", "The.Show.S01E02"}


@pytest.mark.asyncio
async def test_a_general_source_backfill_indexes_only_files_outside_named_topics(arr_app):
    _forum_with_posts(arr_app.telegram)
    source = await _general_source(arr_app)

    (await arr_app.http.post(f"/api/channels/{source['id']}/backfill")).raise_for_status()

    async def finished():
        logs = (await arr_app.http.get("/api/logs", params={"channel_id": source["id"]})).json()
        return any("[Backfill]" in line["message"] for line in logs)

    await eventually(finished)
    assert await _episodes(arr_app) == {"The.Show.S01E01", "The.Show.S01E02"}


@pytest.mark.asyncio
async def test_a_named_topic_source_still_reads_its_replies(arr_app):
    forum = _forum_with_posts(arr_app.telegram)
    source = await arr_app.add_channel(FORUM, kind="tv", topic_id=forum.topic_id("Sèries HD"),
                                       topic_title="Sèries HD")

    await arr_app.scan(source["id"])

    assert await _episodes(arr_app) == {"The.Show.S01E03", "The.Show.S01E04"}
