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
from typing import Any, Callable

import httpx
from telethon import utils
from telethon.errors import FloodWaitError
from telethon.tl import types
from telethon.tl.functions.messages import CheckChatInviteRequest

BASE_URL = "http://telegrarr.test"
POLL_INTERVAL_S = 0.02
POLL_TIMEOUT_S = 5.0


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
    entities: tuple = ()
    reply_markup: Any = None


@dataclass
class FakeChannel:
    chat_id: int
    title: str
    username: str | None = None
    messages: dict[int, FakeMessage] = field(default_factory=dict)
    payloads: dict[int, bytes] = field(default_factory=dict)


class FakeTelegram:
    """Stand-in for the shared Telethon client.

    Implements just the client surface the app calls. It has no
    ``_borrow_exported_sender``, so the downloader's fast path fails over to the
    sequential ``download_media`` path, which serves the canned bytes.
    """

    def __init__(self) -> None:
        self.channels: dict[int, FakeChannel] = {}
        self.downloaded: list[tuple[int, int]] = []   # (chat_id, message_id) served
        self.invites: dict[str, int | str] = {}      # invite hash -> member chat_id | title (not a member)
        self.requests: list[Any] = []                # raw TL requests sent via client(...)
        self.lookups: list[int | str] = []           # every get_entity() query, in order
        self.history_reads: list[int] = []           # chat ids whose messages were iterated
        self.flood_after_lookups: int | None = None  # raise FloodWaitError once this many lookups ran
        self.flood_seconds = 30
        self.saved_messages: list[str] = []          # texts sent to the account's Saved Messages
        self._next_doc_id = 1
        self._downloads_open = asyncio.Event()
        self._downloads_open.set()

    def hold_downloads(self) -> None:
        """Block file transfers (they stay in-flight) until :meth:`release_downloads`."""
        self._downloads_open.clear()

    def release_downloads(self) -> None:
        self._downloads_open.set()

    # canned data ---------------------------------------------------------
    def add_channel(self, chat_id: int, title: str, *, username: str | None = None) -> FakeChannel:
        channel = FakeChannel(chat_id=chat_id, title=title, username=username)
        self.channels[chat_id] = channel
        return channel

    def post(self, chat_id: int, *, text: str, file_name: str, content: bytes = b"x" * 1024,
             message_id: int | None = None) -> FakeMessage:
        """Post a media message with ``content`` as its file bytes."""
        channel = self.channels[chat_id]
        mid = message_id if message_id is not None else max(channel.messages, default=0) + 1
        doc = FakeDocument(id=self._next_doc_id, size=len(content), file_name=file_name)
        self._next_doc_id += 1
        msg = FakeMessage(id=mid, chat_id=chat_id, message=text, document=doc)
        channel.messages[mid] = msg
        channel.payloads[mid] = content
        return msg

    def post_text(self, chat_id: int, text: str, *, urls: tuple[str, ...] = (),
                  buttons: tuple[str, ...] = ()) -> FakeMessage:
        """Post a text-only message. ``urls`` become hidden text-link entities and
        ``buttons`` inline URL buttons, the two other places Telegram carries links."""
        channel = self.channels[chat_id]
        mid = max(channel.messages, default=0) + 1
        entities = tuple(types.MessageEntityTextUrl(offset=0, length=1, url=u) for u in urls)
        markup = types.ReplyInlineMarkup(rows=[types.KeyboardButtonRow(
            buttons=[types.KeyboardButtonUrl(text="open", url=u) for u in buttons])]) if buttons else None
        msg = FakeMessage(id=mid, chat_id=chat_id, message=text, document=None,
                          entities=entities, reply_markup=markup)
        channel.messages[mid] = msg
        return msg

    def add_invite(self, invite_hash: str, *, chat_id: int | None = None, title: str = "") -> None:
        """An invite link: to ``chat_id`` if the account is a member, else only a title."""
        self.invites[invite_hash] = chat_id if chat_id is not None else title

    def _entity(self, channel: FakeChannel) -> types.Channel:
        bare_id, _ = utils.resolve_id(channel.chat_id)
        return types.Channel(id=bare_id, title=channel.title, photo=types.ChatPhotoEmpty(), date=None,
                             broadcast=True, access_hash=1, username=channel.username)

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
        return self._entity(channel)

    async def __call__(self, request: Any) -> Any:
        self.requests.append(request)
        if not isinstance(request, CheckChatInviteRequest):
            raise AssertionError(f"unexpected Telegram request {type(request).__name__}")
        self._lookup(request.hash)
        target = self.invites.get(request.hash)
        if target is None:
            raise ValueError("INVITE_HASH_INVALID")
        if isinstance(target, str):
            return types.ChatInvite(title=target, photo=types.PhotoEmpty(id=0), participants_count=0, color=0)
        return types.ChatInviteAlready(chat=self._entity(self.channels[target]))

    async def iter_messages(self, chat_id: int, limit: int | None = None):
        self.history_reads.append(chat_id)
        msgs = sorted(self.channels[chat_id].messages.values(), key=lambda m: -m.id)
        for msg in msgs[:limit] if limit else msgs:
            yield msg

    async def send_message(self, entity: str, text: str) -> None:
        assert entity == "me", "notifications only ever go to Saved Messages"
        self.saved_messages.append(text)

    async def get_messages(self, chat_id: int, ids: int | None = None) -> FakeMessage | None:
        return self.channels[chat_id].messages.get(ids)

    async def download_media(self, message: FakeMessage, file: str | None = None,
                             progress_callback: Callable[[int, int], Any] | None = None) -> str:
        await self._downloads_open.wait()
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

    async def publish_episodes(self, chat_id: int, show: str, *episodes: int) -> list[str]:
        """A scanned series channel with one season-1 post per episode; returns
        the NZB urls Sonarr would grab them by, in ``episodes`` order."""
        self.telegram.add_channel(chat_id, show)
        dotted = show.replace(" ", ".")
        for ep in episodes:
            self.telegram.post(chat_id, text=f"{show} S01E{ep:02d} 1080p", file_name=f"{dotted}.S01E{ep:02d}.mkv")
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
