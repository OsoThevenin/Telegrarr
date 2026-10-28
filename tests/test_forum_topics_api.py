"""Picking forum topics when adding a source (#26), driven over HTTP as the UI does.

`GET /api/telegram/topics?chat_id=…` lists a forum group's topics so the
add-channel dialog can offer one source per topic; any other chat answers
"not a forum" and the dialog keeps its old flow.
"""
import pytest

FORUM = -1007200000001
PLAIN_CHANNEL = -1007200000002


@pytest.fixture(autouse=True)
def _open_flood_gate(monkeypatch):
    """Each test starts with an open FloodWait gate."""
    from app import downloader
    from app.safety import FloodGate

    monkeypatch.setattr(downloader, "flood_gate", FloodGate())


async def _topics(arr_app, chat_id):
    return await arr_app.http.get("/api/telegram/topics", params={"chat_id": chat_id})


@pytest.mark.asyncio
async def test_topics_of_a_forum_group_are_listed_with_ids_and_titles(arr_app):
    forum = arr_app.telegram.add_forum(FORUM, "Anime en català", topics=("Pel·lícules HD", "Sèries HD"))

    r = await _topics(arr_app, FORUM)

    body = r.raise_for_status().json()
    assert body["forum"] is True
    assert body["topics"] == [
        {"topic_id": 1, "title": "General"},       # General is listed (and pickable) like any topic
        {"topic_id": forum.topic_id("Pel·lícules HD"), "title": "Pel·lícules HD"},
        {"topic_id": forum.topic_id("Sèries HD"), "title": "Sèries HD"},
    ]


@pytest.mark.asyncio
async def test_a_forum_whose_entity_hides_the_forum_flag_is_still_listed(arr_app):
    # Telegram can hand back a "min"/partial Channel whose forum flag is unset even
    # though the chat is a forum; detection must trust the topics request, not the flag.
    forum = arr_app.telegram.add_forum(
        FORUM, "Anime en català", topics=("Pel·lícules HD", "Sèries HD"), hide_forum_flag=True)

    r = await _topics(arr_app, FORUM)

    body = r.raise_for_status().json()
    assert body["forum"] is True
    assert body["topics"] == [
        {"topic_id": 1, "title": "General"},
        {"topic_id": forum.topic_id("Pel·lícules HD"), "title": "Pel·lícules HD"},
        {"topic_id": forum.topic_id("Sèries HD"), "title": "Sèries HD"},
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize("add_chat", ["add_channel", "add_group"])
async def test_a_channel_or_plain_group_answers_not_a_forum(arr_app, add_chat):
    getattr(arr_app.telegram, add_chat)(PLAIN_CHANNEL, "Merlí [CAT] 1080p")

    r = await _topics(arr_app, PLAIN_CHANNEL)

    assert r.raise_for_status().json() == {"forum": False, "topics": []}


@pytest.mark.asyncio
async def test_ticking_two_listed_topics_adds_one_source_each_with_its_own_kind(arr_app):
    arr_app.telegram.add_forum(FORUM, "Anime en català", topics=("Pel·lícules HD", "Sèries HD", "Novetats"))
    listed = {t["title"]: t for t in (await _topics(arr_app, FORUM)).json()["topics"]}
    ticked = [(listed["Pel·lícules HD"], "movie"), (listed["Sèries HD"], "tv")]

    for topic, kind in ticked:      # the dialog posts one source per ticked topic
        await arr_app.add_channel(FORUM, kind=kind, topic_id=topic["topic_id"], topic_title=topic["title"])

    rows = (await arr_app.http.get("/api/channels")).raise_for_status().json()
    assert sorted((r["title"], r["topic_title"], r["kind"]) for r in rows) == [
        ("Anime en català", "Pel·lícules HD", "movie"),
        ("Anime en català", "Sèries HD", "tv"),
    ]
    assert {r["topic_id"] for r in rows} == {listed["Pel·lícules HD"]["topic_id"], listed["Sèries HD"]["topic_id"]}


@pytest.mark.asyncio
async def test_a_floodwait_while_listing_topics_closes_the_gate_and_later_requests_wait(arr_app):
    tg = arr_app.telegram
    tg.add_forum(FORUM, "Anime en català", topics=("Pel·lícules HD",))
    tg.flood_after_lookups = 0

    first = await _topics(arr_app, FORUM)
    tg.flood_after_lookups = None
    sent = len(tg.lookups), len(tg.requests)
    again = await _topics(arr_app, FORUM)

    assert first.status_code == 429
    assert first.json()["detail"]["key"] == "err.topics.rate_limited"
    assert again.status_code == 429
    assert again.json()["detail"]["key"] == "err.topics.rate_limit_active"
    assert (len(tg.lookups), len(tg.requests)) == sent     # a closed gate asks Telegram nothing


@pytest.mark.asyncio
async def test_listing_topics_of_an_unknown_chat_is_a_keyed_error(arr_app):
    r = await _topics(arr_app, FORUM)

    assert r.status_code == 502
    assert r.json()["detail"] == {"key": "err.topics.read_failed", "params": {"error": "ValueError"}}


@pytest.mark.asyncio
async def test_the_topic_picker_module_is_served_and_used_by_the_add_channel_dialog(arr_app):
    picker = await arr_app.http.get("/static/js/topics.js")
    views = await arr_app.http.get("/static/js/views.js")

    assert picker.status_code == 200
    assert "javascript" in picker.headers["content-type"]
    assert "/api/telegram/topics" in picker.text
    assert 'from "./topics.js"' in views.raise_for_status().text


@pytest.mark.asyncio
async def test_a_non_numeric_chat_id_is_refused(arr_app):
    r = await _topics(arr_app, "abc")

    assert r.status_code == 400
    assert r.json()["detail"]["key"] == "err.channel.chat_id_numeric"


def _numbered_topics(n):
    return tuple(f"Sèrie {i:03d}" for i in range(1, n + 1))


@pytest.mark.asyncio
async def test_a_forum_with_more_topics_than_one_page_lists_every_topic(arr_app):
    tg = arr_app.telegram
    tg.add_forum(FORUM, "Arxiu de sèries", topics=_numbered_topics(250))

    r = await _topics(arr_app, FORUM)

    titles = [t["title"] for t in r.raise_for_status().json()["topics"]]
    assert titles == ["General", *_numbered_topics(250)]
    assert len(tg.requests) == 3       # pages of 100 topics


@pytest.mark.asyncio
async def test_a_huge_forum_lists_at_most_the_topic_cap(arr_app):
    from app import tg as tg_module

    arr_app.telegram.add_forum(FORUM, "Arxiu de sèries", topics=_numbered_topics(tg_module.FORUM_TOPICS_MAX + 50))

    r = await _topics(arr_app, FORUM)

    assert len(r.raise_for_status().json()["topics"]) == tg_module.FORUM_TOPICS_MAX


@pytest.mark.asyncio
async def test_a_floodwait_on_a_later_topics_page_closes_the_gate(arr_app):
    tg = arr_app.telegram
    tg.add_forum(FORUM, "Arxiu de sèries", topics=_numbered_topics(250))
    tg.flood_on_topics_page = 2

    first = await _topics(arr_app, FORUM)
    again = await _topics(arr_app, FORUM)

    assert first.status_code == 429
    assert first.json()["detail"]["key"] == "err.topics.rate_limited"
    assert again.json()["detail"]["key"] == "err.topics.rate_limit_active"
    assert len(tg.requests) == 2       # the closed gate stopped the second listing before Telegram
