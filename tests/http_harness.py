"""HTTP test harness: drive the app over HTTP exactly as Sonarr/Radarr do.

The app runs for real (routes, DB, scanner, downloader). Only two things are
substituted, both at the process boundary:

* the Telegram client (``tg._client``) -> :class:`FakeTelegram`, which serves
  canned channels, messages and file bytes;
* settings/paths that point at the host filesystem (library dirs) -> tmp dirs.

The app lifespan is NOT run (``httpx.ASGITransport`` skips it), so there is no
background scan loop and no real Telethon connect; tests trigger scans over HTTP.
"""
from __future__ import annotations

import asyncio
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import Any, Callable, Iterable

import httpx
from telethon import utils
from telethon.errors import ChannelForumMissingError, ChannelPrivateError, FloodWaitError, MsgIdInvalidError
from telethon.tl import types
from telethon.tl.functions.messages import GetForumTopicsRequest

BASE_URL = "http://telegrarr.test"
POLL_INTERVAL_S = 0.02
POLL_TIMEOUT_S = 5.0
GENERAL_TOPIC_ID = 1          # Telegram's id for a forum group's General topic
GENERAL_TOPIC_TITLE = "General"


# ── fake Telegram ─────────────────────────────────────────────────────
@dataclass(frozen=True)
class FakeDocument:
    """Shape of a Telethon ``Document`` as the app reads it."""
    id: int
    size: int
    file_name: str
    dc_id: int = 2
    access_hash: int = 0
    file_reference: bytes = b""

    @property
    def attributes(self) -> list[SimpleNamespace]:
        return [SimpleNamespace(file_name=self.file_name)]


@dataclass(frozen=True)
class FakeMessage:
    """Shape of a Telethon ``Message`` carrying a document."""
    id: int
    chat_id: int
    message: str
    document: FakeDocument | None
    video: None = None
    reply_to: Any = None        # MessageReplyHeader(forum_topic=True, ...) inside a named topic
    action: Any = None          # set on service messages (forum creation, topic creation)


@dataclass(frozen=True)
class HistoryRead:
    """One history read as Telegram sees it: its window on the chat."""
    chat_id: int
    limit: int | None
    offset_id: int
    min_id: int
    topic: int | None


class FakeMessageIter:
    """What ``iter_messages`` returns: like Telethon's iterator it yields messages
    and, once the first chunk arrived, knows Telegram's message count (``total``)."""

    def __init__(self, telegram: "FakeTelegram", read: HistoryRead) -> None:
        self._telegram = telegram
        self._read = read
        self.total: int | None = None

    def __aiter__(self):
        return self._messages()

    async def _messages(self):
        tg, read = self._telegram, self._read
        tg.history_reads.append(read.chat_id)
        tg.reads.append(read)
        await tg.history_gate(read)
        chat = tg.readable(read.chat_id)
        keep = tg.in_topic(chat, read.topic) if read.topic is not None else (lambda _m: True)
        msgs = sorted((m for m in chat.messages.values() if keep(m)), key=lambda m: -m.id)
        self.total = tg.count_reported(len(msgs))
        window = [m for m in msgs if m.id > read.min_id and (not read.offset_id or m.id < read.offset_id)]
        for msg in window[:read.limit] if read.limit else window:
            yield msg


@dataclass
class FakeChannel:
    """A chat: a broadcast channel, or (``forum=True``) a forum group whose
    ``topics`` map each named topic's id (its creation message id) to its title."""
    chat_id: int
    title: str
    username: str | None = None
    messages: dict[int, FakeMessage] = field(default_factory=dict)
    payloads: dict[int, bytes] = field(default_factory=dict)
    forum: bool = False
    topics: dict[int, str] = field(default_factory=dict)
    group: bool = False         # a plain (non-forum) supergroup rather than a channel
    hide_forum_flag: bool = False   # a "min"/partial Channel whose forum flag is unset though it is a forum
    photo: bytes | None = None      # its small profile photo, if it has one

    def topic_id(self, title: str) -> int:
        """The id of the named topic ``title`` (``GENERAL_TOPIC_ID`` for General)."""
        if title == GENERAL_TOPIC_TITLE:
            return GENERAL_TOPIC_ID
        return next(tid for tid, t in self.topics.items() if t == title)

    def next_message_id(self) -> int:
        return max(self.messages, default=0) + 1

    def topic_header(self, topic: int | None, reply_to: int | None = None) -> types.MessageReplyHeader | None:
        """How Telegram marks a message posted in ``topic``, optionally as a reply
        to message ``reply_to`` there.

        In a named topic every message has a ``forum_topic`` header: a top-level
        post points at the topic (``reply_to_msg_id``), and a reply points at the
        replied message, with the topic in ``reply_to_top_id``. In General (or no
        topic) a top-level post has no header, and a reply has a plain header
        without ``forum_topic``."""
        if topic is None or topic == GENERAL_TOPIC_ID:
            return types.MessageReplyHeader(reply_to_msg_id=reply_to) if reply_to else None
        if topic not in self.topics:
            raise AssertionError(f"chat {self.chat_id} has no topic {topic}")
        if reply_to:
            return types.MessageReplyHeader(forum_topic=True, reply_to_msg_id=reply_to, reply_to_top_id=topic)
        return types.MessageReplyHeader(forum_topic=True, reply_to_msg_id=topic)


class FakeTelegram:
    """Stand-in for the shared Telethon client.

    Implements just the client surface the app calls. It has no
    ``_borrow_exported_sender``, so the downloader's fast path fails over to the
    sequential ``download_media`` path, which serves the canned bytes.
    """

    def __init__(self) -> None:
        self.channels: dict[int, FakeChannel] = {}
        self.downloaded: list[tuple[int, int]] = []   # (chat_id, message_id) served
        self.requests: list[Any] = []                # raw TL requests sent via client(...)
        self.lookups: list[int | str] = []           # every get_entity() query, in order
        self.history_reads: list[int] = []           # chat ids whose messages were iterated
        self.reads: list[HistoryRead] = []           # those same reads, with their windows
        self.message_reads: list[int] = []           # chat ids asked for a message by id
        self.photo_reads: list[int] = []             # chat ids whose profile photo was downloaded
        self.flood_on_photo = False                  # raise FloodWaitError downloading a profile photo
        self.flood_after_lookups: int | None = None  # raise FloodWaitError once this many lookups ran
        self.flood_seconds = 30
        self.flood_on_next_read = False              # raise FloodWaitError serving the next history read
        self.flood_on_next_message = False           # raise FloodWaitError serving the next message by id
        self.count_reported = lambda count: count    # what a read says the chat's message count is
        self.fail_next_read = False                  # raise a transient error serving the next history read
        self.flood_on_topics_page: int | None = None  # raise FloodWaitError serving this topics page (1 = first)
        self.topics_pages_served = 0
        self.saved_messages: list[str] = []          # texts sent to the account's Saved Messages
        self.inaccessible: set[int] = set()          # chat ids the account lost access to
        self._next_doc_id = 1
        self._downloads_open = asyncio.Event()
        self._downloads_open.set()
        self._hold_partial = False
        self._late_outcome: type[BaseException] | None = None
        self._finish_despite_cancel = False
        self._history_open = asyncio.Event()
        self._history_open.set()
        self._held_limit: int | None = None
        self._held_after = 0
        self._photos_open = asyncio.Event()
        self._photos_open.set()

    def reads_of(self, chat_id: int) -> int:
        """Every Telegram read of ``chat_id`` so far: history, messages by id, lookups, photos."""
        reads = (*self.history_reads, *self.message_reads, *self.lookups, *self.photo_reads)
        return sum(1 for chat in reads if chat == chat_id)

    def hold_history(self, limit: int | None = None, after: int = 0) -> None:
        """Block history reads, once counted, until :meth:`release_history`: all of
        them, or those asking for ``limit`` messages, letting ``after`` of them by."""
        self._held_limit, self._held_after = limit, after
        self._history_open.clear()

    def release_history(self) -> None:
        self._history_open.set()

    def _is_held(self, read: HistoryRead) -> bool:
        if self._held_limit not in (None, read.limit):
            return False
        if self._held_after:
            self._held_after -= 1
            return False
        return True

    async def history_gate(self, read: HistoryRead) -> None:
        """Where a history read waits while held, and meets a planned FloodWait."""
        if self._is_held(read):
            await self._history_open.wait()
        if self.flood_on_next_read:
            self.flood_on_next_read = False
            raise FloodWaitError(request=None, capture=self.flood_seconds)
        if self.fail_next_read:
            self.fail_next_read = False
            raise ConnectionError("Telegram went away")

    def hold_photos(self) -> None:
        """Block profile-photo downloads, once counted, until :meth:`release_photos`."""
        self._photos_open.clear()

    def release_photos(self) -> None:
        self._photos_open.set()

    def hold_downloads(self, *, partial: bool = False,
                       late_outcome: type[BaseException] | None = None,
                       finish_despite_cancel: bool = False) -> None:
        """Block file transfers (they stay in-flight) until :meth:`release_downloads`.

        With ``partial``, a held transfer first writes its first byte, leaving a
        partial file on disk the way an interrupted real transfer does. With
        ``late_outcome``, a held transfer that is cancelled keeps winding down
        (the chunk in flight) until release, then raises ``late_outcome``. With
        ``finish_despite_cancel``, it delivers the whole file at release instead,
        as a fallback already past its last chunk does."""
        self._hold_partial = partial
        self._late_outcome = late_outcome
        self._finish_despite_cancel = finish_despite_cancel
        self._downloads_open.clear()

    def release_downloads(self) -> None:
        self._downloads_open.set()

    # canned data ---------------------------------------------------------
    def add_channel(self, chat_id: int, title: str, *, username: str | None = None) -> FakeChannel:
        channel = FakeChannel(chat_id=chat_id, title=title, username=username)
        self.channels[chat_id] = channel
        return channel

    def add_group(self, chat_id: int, title: str, *, username: str | None = None) -> FakeChannel:
        """A plain supergroup: not a broadcast channel, and not a forum."""
        group = FakeChannel(chat_id=chat_id, title=title, username=username, group=True)
        self.channels[chat_id] = group
        return group

    def add_forum(self, chat_id: int, title: str, *, topics: tuple[str, ...] = (),
                  username: str | None = None, hide_forum_flag: bool = False) -> FakeChannel:
        """A forum group with the named ``topics`` (plus the implicit General topic).

        As in Telegram, message 1 is the group's creation and each topic's id is
        the id of the service message that created it. With ``hide_forum_flag`` the
        entity ``get_entity`` returns is a "min"/partial ``Channel`` whose ``forum``
        flag is unset, as Telegram sends for some channels, though the chat is a
        forum and serves its topics."""
        forum = FakeChannel(chat_id=chat_id, title=title, username=username, forum=True,
                            hide_forum_flag=hide_forum_flag)
        self.channels[chat_id] = forum
        self._post_service(forum, types.MessageActionChannelCreate(title=title))
        for name in topics:
            created = self._post_service(forum, types.MessageActionTopicCreate(title=name, icon_color=0))
            forum.topics[created.id] = name
        return forum

    def delete_topic(self, chat_id: int, topic: int) -> None:
        """Delete a forum topic as Telegram does: the topic and all its messages
        go, so reading it (``reply_to=topic``) fails with ``MsgIdInvalidError``."""
        forum = self.channels[chat_id]
        del forum.topics[topic]
        def in_topic(m: FakeMessage) -> bool:
            header = m.reply_to
            return bool(header and header.forum_topic
                        and (header.reply_to_top_id or header.reply_to_msg_id) == topic)

        forum.messages = {mid: m for mid, m in forum.messages.items() if mid != topic and not in_topic(m)}

    def lose_access(self, chat_id: int) -> None:
        """The account left, or was removed from, ``chat_id``: as in Telegram,
        every read of it (entity, history, messages) raises ``ChannelPrivateError``."""
        self.inaccessible.add(chat_id)

    def readable(self, chat_id: int) -> FakeChannel:
        if chat_id in self.inaccessible:
            raise ChannelPrivateError(request=None)
        return self.channels[chat_id]

    def _post_service(self, chat: FakeChannel, action: Any) -> FakeMessage:
        msg = FakeMessage(id=chat.next_message_id(), chat_id=chat.chat_id, message="", document=None,
                          action=action)
        chat.messages[msg.id] = msg
        return msg

    def post(self, chat_id: int, *, text: str, file_name: str, content: bytes = b"x" * 1024,
             message_id: int | None = None, topic: int | None = None,
             reply_to: int | None = None) -> FakeMessage:
        """Post a media message with ``content`` as its file bytes, in forum
        ``topic`` if given (None or ``GENERAL_TOPIC_ID``: the General topic),
        as a reply to message ``reply_to`` (in that same topic) if given."""
        channel = self.channels[chat_id]
        mid = message_id if message_id is not None else channel.next_message_id()
        doc = FakeDocument(id=self._next_doc_id, size=len(content), file_name=file_name)
        self._next_doc_id += 1
        msg = FakeMessage(id=mid, chat_id=chat_id, message=text, document=doc,
                          reply_to=channel.topic_header(topic, reply_to))
        channel.messages[mid] = msg
        channel.payloads[mid] = content
        return msg

    def post_text(self, chat_id: int, text: str, *, topic: int | None = None) -> FakeMessage:
        """Post a text-only message (in forum ``topic``, as for :meth:`post`)."""
        channel = self.channels[chat_id]
        mid = channel.next_message_id()
        msg = FakeMessage(id=mid, chat_id=chat_id, message=text, document=None,
                          reply_to=channel.topic_header(topic))
        channel.messages[mid] = msg
        return msg

    def _entity(self, channel: FakeChannel) -> types.Channel:
        bare_id, _ = utils.resolve_id(channel.chat_id)
        megagroup = channel.forum or channel.group
        forum_flag = channel.forum and not channel.hide_forum_flag
        photo = types.ChatPhoto(photo_id=1, dc_id=2) if channel.photo else types.ChatPhotoEmpty()
        return types.Channel(id=bare_id, title=channel.title, photo=photo, date=None,
                             broadcast=not megagroup, megagroup=megagroup, forum=forum_flag,
                             access_hash=1, username=channel.username)

    def _lookup(self, query: int | str) -> None:
        self.lookups.append(query)
        if self.flood_after_lookups is not None and len(self.lookups) > self.flood_after_lookups:
            raise FloodWaitError(request=None, capture=self.flood_seconds)

    # Telethon client surface -----------------------------------------------
    def is_connected(self) -> bool:
        return True

    async def connect(self) -> None:
        return None

    async def disconnect(self) -> None:
        return None

    async def is_user_authorized(self) -> bool:
        return True

    async def get_entity(self, query: int | str) -> types.Channel:
        self._lookup(query)
        if isinstance(query, str):
            channel = next((c for c in self.channels.values()
                            if c.username and c.username.lower() == query.lower()), None)
        else:
            channel = self.channels.get(query)
        if channel is None:
            raise ValueError(f"Cannot find any entity corresponding to {query!r}")
        return self._entity(self.readable(channel.chat_id))

    async def __call__(self, request: Any) -> Any:
        self.requests.append(request)
        if isinstance(request, GetForumTopicsRequest):
            return self._forum_topics(request)
        raise AssertionError(f"unexpected Telegram request {type(request).__name__}")

    def _forum_topics(self, request: GetForumTopicsRequest) -> types.messages.ForumTopics:
        """Answer the forum-topics request: General first, then named topics in
        creation order, one page of ``limit`` topics after ``offset_topic``. A chat
        that isn't a forum is refused, as Telegram does."""
        chat = self.channels[utils.get_peer_id(request.peer)]
        if not chat.forum:
            raise ChannelForumMissingError(request=request)
        self.topics_pages_served += 1
        if self.topics_pages_served == self.flood_on_topics_page:
            raise FloodWaitError(request=request, capture=self.flood_seconds)
        every = [(GENERAL_TOPIC_ID, GENERAL_TOPIC_TITLE), *chat.topics.items()]
        # a later page starts after its offset_topic (the previous page's last topic)
        start = next((i + 1 for i, (tid, _) in enumerate(every) if tid == request.offset_topic), 0)
        listed = every[start:start + request.limit]
        topics = [types.ForumTopic(
            id=tid, date=None, peer=types.PeerChannel(utils.resolve_id(chat.chat_id)[0]), title=title,
            icon_color=0, top_message=tid, read_inbox_max_id=0, read_outbox_max_id=0, unread_count=0,
            unread_mentions_count=0, unread_reactions_count=0, unread_poll_votes_count=0,
            from_id=types.PeerUser(0), notify_settings=types.PeerNotifySettings()) for tid, title in listed]
        return types.messages.ForumTopics(count=1 + len(chat.topics), topics=topics, messages=[],
                                          chats=[], users=[], pts=0)

    def in_topic(self, chat: FakeChannel, topic: int) -> Callable[[FakeMessage], bool]:
        """Telethon's ``reply_to=topic`` filter: the topic's posts and replies, not
        its creation message. Like Telegram, it can't read the General topic or a
        non-forum chat."""
        if not chat.forum or topic not in chat.topics:
            raise MsgIdInvalidError(request=None)

        def in_topic(m: FakeMessage) -> bool:
            header = m.reply_to
            if header is None or not header.forum_topic:
                return False
            return (header.reply_to_top_id or header.reply_to_msg_id) == topic

        return in_topic

    def iter_messages(self, chat_id: int, limit: int | None = None, *, reply_to: int | None = None,
                      offset_id: int = 0, min_id: int = 0) -> FakeMessageIter:
        """``offset_id`` and ``min_id`` bound the read as in Telethon: only messages
        older than ``offset_id`` (0: from the newest) and newer than ``min_id``."""
        return FakeMessageIter(self, HistoryRead(chat_id, limit, offset_id, min_id, reply_to))

    async def send_message(self, entity: str, text: str) -> None:
        assert entity == "me", "notifications only ever go to Saved Messages"
        self.saved_messages.append(text)

    async def get_messages(self, chat_id: int, ids: int | None = None) -> FakeMessage | None:
        self.message_reads.append(chat_id)
        if self.flood_on_next_message:
            self.flood_on_next_message = False
            raise FloodWaitError(request=None, capture=self.flood_seconds)
        return self.readable(chat_id).messages.get(ids)

    async def download_profile_photo(self, entity: types.Channel, file: Any = None, *,
                                     download_big: bool = True) -> bytes | None:
        assert file is bytes and not download_big, "the app asks for the small photo, in memory"
        chat_id = utils.get_peer_id(entity)
        self.photo_reads.append(chat_id)
        await self._photos_open.wait()
        if self.flood_on_photo:
            raise FloodWaitError(request=None, capture=self.flood_seconds)
        return self.readable(chat_id).photo

    async def _wait_until_released(self) -> None:
        try:
            await self._downloads_open.wait()
        except asyncio.CancelledError:
            late = self._late_outcome
            if late is None and not self._finish_despite_cancel:
                raise
            await self._downloads_open.wait()   # finish the chunk in flight first
            if late is not None:
                raise late("transfer stopped late") from None

    async def download_media(self, message: FakeMessage, file: str | None = None,
                             progress_callback: Callable[[int, int], Any] | None = None) -> str:
        if self._hold_partial and not self._downloads_open.is_set():
            with open(file, "wb") as fh:
                fh.write(self.channels[message.chat_id].payloads[message.id][:1])
        await self._wait_until_released()
        data = self.channels[message.chat_id].payloads[message.id]
        with open(file, "wb") as fh:
            fh.write(data)
        self.downloaded.append((message.chat_id, message.id))
        if progress_callback:
            result = progress_callback(len(data), len(data))
            if asyncio.iscoroutine(result):
                await result
        return file


# ── the app, seen from Sonarr/Radarr ─────────────────────────────────
@dataclass
class ArrApp:
    """An authenticated HTTP client on the app plus its fake Telegram."""
    http: httpx.AsyncClient
    telegram: FakeTelegram
    apikey: str

    async def settings(self) -> dict:
        """The public settings view, as ``GET /api/settings`` answers it."""
        return (await self.http.get("/api/settings")).raise_for_status().json()["settings"]

    async def add_channel(self, chat_id: int, *, kind: str = "tv", **fields: Any) -> dict:
        """Add a source channel through the UI's API; returns the channel row."""
        r = await self.http.post("/api/channels", json={"chat_id": chat_id, "kind": kind, **fields})
        return r.raise_for_status().json()

    async def scan(self, channel_id: int) -> dict:
        """Trigger a channel scan over HTTP and wait until it has finished."""
        (await self.http.post(f"/api/channels/{channel_id}/scan")).raise_for_status()

        async def scanned() -> dict | None:
            channels = (await self.http.get("/api/channels")).raise_for_status().json()
            row = next((c for c in channels if c["id"] == channel_id), None)
            return row if row and row["last_scanned_at"] else None

        return await eventually(scanned)

    async def history_slot(self, nzo_id: str) -> dict:
        """Wait for ``nzo_id`` to reach SABnzbd history; return its slot."""
        async def slot() -> dict | None:
            r = await self.http.get("/sabnzbd/api", params={"mode": "history", "apikey": self.apikey})
            slots = r.raise_for_status().json()["history"]["slots"]
            return next((s for s in slots if s["nzo_id"] == nzo_id), None)

        return await eventually(slot)

    async def sab(self, **params: Any) -> dict:
        """One SABnzbd API call, as Sonarr/Radarr make it."""
        r = await self.http.get("/sabnzbd/api", params={"apikey": self.apikey, "output": "json", **params})
        return r.raise_for_status().json()

    async def grab(self, url: str, *, cat: str = "tv") -> str:
        """Hand ``url`` to SABnzbd as Sonarr/Radarr do; returns its nzo_id."""
        [nzo] = (await self.sab(mode="addurl", name=url, cat=cat))["nzo_ids"]
        return nzo

    async def history_ids(self, **params: Any) -> list[str]:
        """The nzo_ids SABnzbd history reports, in its order."""
        history = await self.sab(mode="history", **params)
        return [s["nzo_id"] for s in history["history"]["slots"]]

    async def offers_episode(self, show: str, episode: int) -> bool:
        """Whether Newznab offers this season-1 episode of ``show``, searched as Sonarr does."""
        r = await self.http.get("/api/newznab", params={
            "t": "tvsearch", "apikey": self.apikey, "q": show, "season": 1, "ep": episode})
        return bool(ET.fromstring(r.raise_for_status().text).findall("./channel/item"))

    def post_episodes(self, chat_id: int, show: str, episodes: Iterable[int], topic: int | None = None) -> None:
        """One season-1 post per episode on the fake Telegram channel ``chat_id``."""
        dotted = show.replace(" ", ".")
        for ep in episodes:
            self.telegram.post(chat_id, text=f"{show} S01E{ep:02d} 1080p", file_name=f"{dotted}.S01E{ep:02d}.mkv",
                               topic=topic)

    async def episode_url(self, show: str, ep: int) -> str:
        """Wait for season-1 episode ``ep`` of ``show`` to be searchable; returns its NZB url."""
        async def search() -> str | None:
            r = await self.http.get("/api/newznab", params={
                "t": "tvsearch", "apikey": self.apikey, "q": show, "season": 1, "ep": ep})
            items = ET.fromstring(r.raise_for_status().text).findall("./channel/item")
            return items[0].find("enclosure").attrib["url"] if items else None

        return await eventually(search)

    async def publish_episodes(self, chat_id: int, show: str, *episodes: int) -> list[str]:
        """A scanned series channel with one season-1 post per episode; returns
        the NZB urls Sonarr would grab them by, in ``episodes`` order."""
        self.telegram.add_channel(chat_id, show)
        self.post_episodes(chat_id, show, episodes)
        channel = await self.add_channel(chat_id)
        await self.scan(channel["id"])
        r = await self.http.get("/api/newznab", params={"t": "tvsearch", "apikey": self.apikey, "q": show})
        items = ET.fromstring(r.raise_for_status().text).findall("./channel/item")
        urls = {i.find("title").text: i.find("enclosure").attrib["url"] for i in items}
        return [next(u for title, u in urls.items() if f"S01E{ep:02d}" in title) for ep in episodes]

    async def download(self, file_name: str) -> dict | None:
        """The UI's download row for ``file_name``, if any."""
        rows = (await self.http.get("/api/downloads")).raise_for_status().json()
        return next((d for d in rows if d["file_name"] == file_name), None)


LIBRARY_DIR_NAMES = ("TV_DIR", "TV_DIR_4K", "MOVIES_DIR", "MOVIES_DIR_4K", "OTHER_DIR")


def library_dirs_under(root: str) -> dict[str, str]:
    """Map each library-dir setting to a subdir of ``root`` (e.g. TV_DIR -> root/tv)."""
    return {name: f"{root}/{name.lower().removesuffix('_dir').replace('_dir', '')}"
            for name in LIBRARY_DIR_NAMES}


async def eventually(probe: Callable[[], Any], *, timeout: float = POLL_TIMEOUT_S) -> Any:
    """Poll the async ``probe`` until it returns a truthy value; return it."""
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while True:
        result = await probe()
        if result:
            return result
        if loop.time() >= deadline:
            raise AssertionError(f"condition not met within {timeout}s (last: {result!r})")
        await asyncio.sleep(POLL_INTERVAL_S)
