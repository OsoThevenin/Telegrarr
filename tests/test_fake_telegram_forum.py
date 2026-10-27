"""The fake Telegram models forum groups the way Telethon presents them.

Topic-source tests (#23) rely on this contract: a forum group with named topics
and a General topic, the forum-topics request, and topic-filtered iteration.
"""
import pytest
from telethon.errors import ChannelForumMissingError, MsgIdInvalidError
from telethon.tl.functions.messages import GetForumTopicsRequest

from http_harness import GENERAL_TOPIC_ID, FakeTelegram

FORUM = -1007000000001
CHANNEL = -1007000000002


def _topics_request(peer):
    return GetForumTopicsRequest(peer=peer, offset_date=None, offset_id=0, offset_topic=0, limit=100)


@pytest.mark.asyncio
async def test_forum_topics_request_lists_general_and_named_topics():
    tg = FakeTelegram()
    forum = tg.add_forum(FORUM, "Anime i molt més", topics=("Pel·lícules HD", "Sèries HD"))

    result = await tg(_topics_request(await tg.get_entity(FORUM)))

    assert [(t.id, t.title) for t in result.topics] == [
        (GENERAL_TOPIC_ID, "General"),
        (forum.topic_id("Pel·lícules HD"), "Pel·lícules HD"),
        (forum.topic_id("Sèries HD"), "Sèries HD"),
    ]
    assert result.count == 3


@pytest.mark.asyncio
async def test_forum_topics_request_refuses_a_chat_that_is_not_a_forum():
    tg = FakeTelegram()
    tg.add_channel(CHANNEL, "Sèries en català")

    with pytest.raises(ChannelForumMissingError):
        await tg(_topics_request(await tg.get_entity(CHANNEL)))


@pytest.mark.asyncio
async def test_forum_entity_is_a_forum_megagroup_and_a_channel_is_not():
    tg = FakeTelegram()
    tg.add_forum(FORUM, "Anime", topics=("Pel·lícules HD",))
    tg.add_channel(CHANNEL, "Sèries en català")

    forum, channel = await tg.get_entity(FORUM), await tg.get_entity(CHANNEL)

    assert (forum.forum, forum.megagroup, forum.broadcast) == (True, True, False)
    assert not channel.forum and channel.broadcast


def _forum_with_posts(tg):
    forum = tg.add_forum(FORUM, "Anime", topics=("Pel·lícules HD", "Sèries HD"))
    films, series = forum.topic_id("Pel·lícules HD"), forum.topic_id("Sèries HD")
    tg.post(FORUM, text="La guerra dels mons (1953)", file_name="guerra.mkv", topic=films)
    tg.post_text(FORUM, "https://t.me/merli_cat", topic=series)
    tg.post(FORUM, text="Nausicaä (1984)", file_name="nausicaa.mkv", topic=films)
    tg.post(FORUM, text="loose file", file_name="loose.mkv", topic=GENERAL_TOPIC_ID)
    tg.post_text(FORUM, "hola a tothom")
    return forum


@pytest.mark.asyncio
async def test_topic_filter_yields_only_that_topics_posts_newest_first():
    tg = FakeTelegram()
    forum = _forum_with_posts(tg)

    films = [m.message async for m in tg.iter_messages(FORUM, reply_to=forum.topic_id("Pel·lícules HD"))]
    series = [m.message async for m in tg.iter_messages(FORUM, reply_to=forum.topic_id("Sèries HD"))]

    assert films == ["Nausicaä (1984)", "La guerra dels mons (1953)"]
    assert series == ["https://t.me/merli_cat"]


@pytest.mark.asyncio
async def test_whole_forum_iteration_yields_every_topic_and_marks_named_topic_posts():
    tg = FakeTelegram()
    forum = _forum_with_posts(tg)

    posts = {m.message: m async for m in tg.iter_messages(FORUM) if m.action is None}

    assert set(posts) == {"La guerra dels mons (1953)", "https://t.me/merli_cat", "Nausicaä (1984)",
                          "loose file", "hola a tothom"}
    assert posts["Nausicaä (1984)"].reply_to.forum_topic is True
    assert posts["Nausicaä (1984)"].reply_to.reply_to_msg_id == forum.topic_id("Pel·lícules HD")
    assert posts["loose file"].reply_to is None and posts["hola a tothom"].reply_to is None


@pytest.mark.asyncio
async def test_topic_filter_cannot_read_the_general_topic():
    tg = FakeTelegram()
    _forum_with_posts(tg)

    with pytest.raises(MsgIdInvalidError):
        _ = [m async for m in tg.iter_messages(FORUM, reply_to=GENERAL_TOPIC_ID)]
