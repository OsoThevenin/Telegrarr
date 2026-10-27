"""Directory scan on a single forum topic (#28), driven over HTTP as the UI does.

A forum group such as "Sèries HD" posts invite links to per-show channels in one
topic. A directory scan given that topic lists only the links posted there; link
resolution (joined chats only, never join) and import are unchanged.
"""
import pytest
from telethon.tl.functions.channels import JoinChannelRequest
from telethon.tl.functions.messages import ImportChatInviteRequest

FORUM = -1007200000001
MERLI = -1007200000002
JOC = -1007200000003
PRIVATE = -1007200000004


@pytest.fixture(autouse=True)
def _isolated_directory_scans(monkeypatch):
    """Resolutions are spaced out for account safety; tests don't wait for it.
    Each test starts with no cached scans and an open FloodWait gate."""
    from app import directory, downloader
    from app.safety import FloodGate

    monkeypatch.setattr(directory, "RESOLVE_INTERVAL_S", 0)
    directory.forget_scans()
    monkeypatch.setattr(downloader, "flood_gate", FloodGate())


def _forum(arr_app):
    tg = arr_app.telegram
    forum = tg.add_forum(FORUM, "Catalan Club", topics=("Pel·lícules HD", "Sèries HD"))
    tg.add_channel(MERLI, "Merlí [CAT] 1080p", username="merli_cat")
    tg.add_channel(JOC, "Joc de trons CAT", username="jocdetrons_cat")
    return tg, forum


async def _scan(arr_app, topic_id=None, chat_id=FORUM):
    r = await arr_app.http.post("/api/directory/scan", json={"chat_id": chat_id, "topic_id": topic_id})
    assert r.status_code == 200, r.text
    return r.json()


def _links(scan):
    return [entry["link"] for entry in scan["links"]]


@pytest.mark.asyncio
async def test_a_topic_scan_lists_only_links_posted_in_that_topic(arr_app):
    tg, forum = _forum(arr_app)
    tg.post_text(FORUM, "Merlí: https://t.me/merli_cat", topic=forum.topic_id("Sèries HD"))
    tg.post_text(FORUM, "A film channel: https://t.me/films_cat", topic=forum.topic_id("Pel·lícules HD"))
    tg.post_text(FORUM, "Joc de trons: https://t.me/jocdetrons_cat")       # General

    scan = await _scan(arr_app, forum.topic_id("Sèries HD"))

    assert _links(scan) == ["https://t.me/merli_cat"]
    assert (scan["links"][0]["chat_id"], scan["links"][0]["title"]) == (MERLI, "Merlí [CAT] 1080p")
    assert scan["directory"] == {"chat_id": FORUM, "title": "Catalan Club"}
    assert scan["topic_id"] == forum.topic_id("Sèries HD")


@pytest.mark.asyncio
async def test_invite_links_in_a_topic_resolve_only_for_joined_chats_and_never_join(arr_app):
    tg, forum = _forum(arr_app)
    tg.add_channel(PRIVATE, "Sèrie privada CAT")
    tg.add_invite("JoinedInviteHash01", chat_id=PRIVATE)
    tg.add_invite("StrangerInviteHash", title="Unknown private channel")
    tg.post_text(FORUM, "https://t.me/+JoinedInviteHash01 i https://t.me/joinchat/StrangerInviteHash",
                 topic=forum.topic_id("Sèries HD"))

    links = {e["link"]: e for e in (await _scan(arr_app, forum.topic_id("Sèries HD")))["links"]}

    joined = links["https://t.me/+JoinedInviteHash01"]
    assert (joined["resolved"], joined["chat_id"], joined["title"]) == (True, PRIVATE, "Sèrie privada CAT")
    stranger = links["https://t.me/+StrangerInviteHash"]
    assert (stranger["resolved"], stranger["chat_id"]) == (False, None)
    assert stranger["error"]["key"] == "err.directory.not_a_member"
    assert not any(isinstance(r, (JoinChannelRequest, ImportChatInviteRequest)) for r in tg.requests)


@pytest.mark.asyncio
async def test_each_topic_and_the_whole_chat_are_remembered_separately(arr_app):
    tg, forum = _forum(arr_app)
    tg.post_text(FORUM, "https://t.me/merli_cat", topic=forum.topic_id("Sèries HD"))
    tg.post_text(FORUM, "https://t.me/jocdetrons_cat", topic=forum.topic_id("Pel·lícules HD"))

    series = await _scan(arr_app, forum.topic_id("Sèries HD"))
    films = await _scan(arr_app, forum.topic_id("Pel·lícules HD"))
    whole = await _scan(arr_app)
    series_again = await _scan(arr_app, forum.topic_id("Sèries HD"))

    assert (_links(series), series["cached"]) == (["https://t.me/merli_cat"], False)
    assert (_links(films), films["cached"]) == (["https://t.me/jocdetrons_cat"], False)
    assert (sorted(_links(whole)), whole["cached"]) == (
        ["https://t.me/jocdetrons_cat", "https://t.me/merli_cat"], False)
    assert (_links(series_again), series_again["cached"]) == (["https://t.me/merli_cat"], True)
    assert len(tg.history_reads) == 3


@pytest.mark.asyncio
async def test_a_general_topic_scan_lists_only_links_posted_outside_named_topics(arr_app):
    tg, forum = _forum(arr_app)
    tg.post_text(FORUM, "https://t.me/merli_cat", topic=forum.topic_id("Sèries HD"))
    tg.post_text(FORUM, "https://t.me/jocdetrons_cat")       # General

    scan = await _scan(arr_app, forum.topic_id("General"))

    assert _links(scan) == ["https://t.me/jocdetrons_cat"]


@pytest.mark.asyncio
@pytest.mark.parametrize("topic_id", ["abc", 0, -3, True])
async def test_a_scan_with_a_malformed_topic_is_rejected_before_asking_telegram(arr_app, topic_id):
    tg, _ = _forum(arr_app)

    r = await arr_app.http.post("/api/directory/scan", json={"chat_id": FORUM, "topic_id": topic_id})

    assert r.status_code == 400
    assert r.json()["detail"]["key"] == "err.channel.topic_id_numeric"
    assert tg.history_reads == []


@pytest.mark.asyncio
async def test_importing_from_a_topic_scan_adds_series_channels_and_marks_them(arr_app):
    tg, forum = _forum(arr_app)
    tg.post_text(FORUM, "https://t.me/merli_cat", topic=forum.topic_id("Sèries HD"))
    [entry] = (await _scan(arr_app, forum.topic_id("Sèries HD")))["links"]

    r = await arr_app.http.post("/api/directory/import", json={"channels": [
        {"chat_id": entry["chat_id"], "title": entry["title"]}]})
    [rescanned] = (await _scan(arr_app, forum.topic_id("Sèries HD")))["links"]

    assert [res["status"] for res in r.raise_for_status().json()["results"]] == ["added"]
    stored = {c["chat_id"]: c for c in (await arr_app.http.get("/api/channels")).json()}
    assert (stored[MERLI]["kind"], stored[MERLI]["title"], stored[MERLI]["topic_id"]) == (
        "tv", "Merlí [CAT] 1080p", None)
    assert set(stored) == {MERLI}                     # the forum itself is not added
    assert (rescanned["already_added"], rescanned["channel_id"]) == (True, stored[MERLI]["id"])
