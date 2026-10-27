"""A topic source whose topic is gone or whose group is no longer accessible
(#29): its scan logs a keyed, translated error naming the source, and the
other sources keep scanning. Driven over HTTP, as the UI and Sonarr see it.
"""
import xml.etree.ElementTree as ET

import pytest

from http_harness import eventually

FORUM = -1007100000029
GROUP = "Anime en català"


async def _logged(arr_app, key: str) -> dict:
    """Wait for the newest event-log row with i18n ``key``; return it."""
    async def row() -> dict | None:
        rows = (await arr_app.http.get("/api/logs")).raise_for_status().json()
        return next((r for r in rows if (r["msg"] or {}).get("key") == key), None)

    return await eventually(row)


async def _topic_source(arr_app, forum, topic: str, *, kind: str = "tv") -> dict:
    return await arr_app.add_channel(FORUM, kind=kind, topic_id=forum.topic_id(topic), topic_title=topic)


@pytest.mark.asyncio
async def test_scanning_a_deleted_topic_logs_a_keyed_error_naming_the_source(arr_app):
    forum = arr_app.telegram.add_forum(FORUM, GROUP, topics=("Sèries HD",))
    source = await _topic_source(arr_app, forum, "Sèries HD")
    arr_app.telegram.delete_topic(FORUM, forum.topic_id("Sèries HD"))

    await arr_app.scan(source["id"])

    row = await _logged(arr_app, "event.topic_gone")
    assert row["msg"]["params"] == {"channel": GROUP, "topic": "Sèries HD"}
    assert row["level"] == "ERROR"
    assert "Sèries HD" in row["message"] and GROUP in row["message"]


@pytest.mark.asyncio
async def test_scanning_a_topic_of_a_group_the_account_lost_access_to_logs_a_keyed_error(arr_app):
    forum = arr_app.telegram.add_forum(FORUM, GROUP, topics=("Pel·lícules HD",))
    source = await _topic_source(arr_app, forum, "Pel·lícules HD", kind="movie")
    arr_app.telegram.lose_access(FORUM)

    await arr_app.scan(source["id"])

    row = await _logged(arr_app, "event.topic_inaccessible")
    assert row["msg"]["params"] == {"channel": GROUP, "topic": "Pel·lícules HD"}
    assert "Pel·lícules HD" in row["message"] and GROUP in row["message"]


async def _offered_episodes(arr_app) -> list[str]:
    """Release titles Sonarr finds when searching the group's name."""
    params = {"t": "tvsearch", "apikey": arr_app.apikey, "q": GROUP}
    feed = (await arr_app.http.get("/api/newznab", params=params)).raise_for_status().text
    return [i.find("title").text for i in ET.fromstring(feed).findall("./channel/item")]


async def _scanned(arr_app, channel_id: int) -> dict:
    """Wait until source ``channel_id`` has finished a scan; return its row."""
    async def row() -> dict | None:
        rows = (await arr_app.http.get("/api/channels")).raise_for_status().json()
        return next((c for c in rows if c["id"] == channel_id and c["last_scanned_at"]), None)

    return await eventually(row)


@pytest.mark.asyncio
async def test_a_deleted_topic_does_not_stop_other_sources_from_scanning(arr_app):
    tg = arr_app.telegram
    forum = tg.add_forum(FORUM, GROUP, topics=("Sèries HD", "Novetats"))
    tg.post(FORUM, text="The Show S01E01 1080p", file_name="The.Show.S01E01.mkv",
            topic=forum.topic_id("Novetats"))
    await _topic_source(arr_app, forum, "Sèries HD")
    healthy = await _topic_source(arr_app, forum, "Novetats")
    tg.delete_topic(FORUM, forum.topic_id("Sèries HD"))

    (await arr_app.http.post("/api/system/tasks/scan_all")).raise_for_status()

    await _logged(arr_app, "event.topic_gone")
    await _scanned(arr_app, healthy["id"])
    [offered] = await _offered_episodes(arr_app)
    assert "S01E01" in offered


@pytest.mark.asyncio
async def test_backfilling_a_deleted_topic_logs_the_same_keyed_error(arr_app):
    forum = arr_app.telegram.add_forum(FORUM, GROUP, topics=("Sèries HD",))
    source = await _topic_source(arr_app, forum, "Sèries HD")
    arr_app.telegram.delete_topic(FORUM, forum.topic_id("Sèries HD"))

    (await arr_app.http.post(f"/api/channels/{source['id']}/backfill")).raise_for_status()

    row = await _logged(arr_app, "event.topic_gone")
    assert row["msg"]["params"] == {"channel": GROUP, "topic": "Sèries HD"}
