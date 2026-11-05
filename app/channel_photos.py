# app/channel_photos.py — channels' Telegram profile photos, cached on disk.
#
# A chat has one cache entry, stamped by its file's mtime: `<chat id>.jpg`, or an
# empty `<chat id>.none` remembering that the chat has no photo. Only a stale or
# missing entry can read Telegram, so showing the grid causes no Telegram traffic.
# The file name comes from the stored chat id as an int, never from the request.
#
# Account safety: reads wait for one shared slot, and the flood gate, the daily
# budget and the scanning switch are checked again right before the read. A read
# that can't happen leaves the entry as it is; the caller gets what is cached.
import asyncio
import logging
import os
import time

from telethon.errors import FloodWaitError

from . import channels, config, downloader, safety, tg

log = logging.getLogger("channel_photos")

PHOTOS_DIR = os.path.join(config.DATA_DIR, "channel_photos")
PHOTO_TTL_S = 7 * 24 * 3600
FAILED_READ_RETRY_S = 3600   # a chat that can't be read is tried again after this long

_read_slot = asyncio.Semaphore(1)   # a first grid render must not burst one read per channel
_reads_in_flight: dict[int, asyncio.Task] = {}


def _now() -> float:
    return time.time()


def _photo_path(chat_id: int) -> str:
    return os.path.join(PHOTOS_DIR, f"{int(chat_id)}.jpg")


def _no_photo_path(chat_id: int) -> str:
    return os.path.join(PHOTOS_DIR, f"{int(chat_id)}.none")


def _entry(chat_id: int) -> str | None:
    """The chat's cache file, if it has one."""
    return next((p for p in (_photo_path(chat_id), _no_photo_path(chat_id)) if os.path.exists(p)), None)


def _is_fresh(chat_id: int) -> bool:
    entry = _entry(chat_id)
    return entry is not None and _now() < os.path.getmtime(entry) + PHOTO_TTL_S


def _cached(chat_id: int) -> bytes | None:
    try:
        with open(_photo_path(chat_id), "rb") as fh:
            return fh.read()
    except FileNotFoundError:
        return None


def _stamp(path: str, when: float) -> None:
    os.utime(path, (when, when))


def _remember_photo(chat_id: int, photo: bytes) -> None:
    path = _photo_path(chat_id)
    partial = f"{path}.part"
    with open(partial, "wb") as fh:
        fh.write(photo)
    _stamp(partial, _now())
    os.replace(partial, path)
    if os.path.exists(_no_photo_path(chat_id)):
        os.remove(_no_photo_path(chat_id))


def _remember_no_photo(chat_id: int) -> None:
    path = _no_photo_path(chat_id)
    with open(path, "wb"):
        pass
    _stamp(path, _now())
    if os.path.exists(_photo_path(chat_id)):
        os.remove(_photo_path(chat_id))


def _retry_soon(chat_id: int) -> None:
    """After a failed read: keep what is cached and try again in FAILED_READ_RETRY_S,
    so an unreadable chat doesn't hit Telegram on every grid render."""
    entry = _entry(chat_id)
    if entry is None:
        _remember_no_photo(chat_id)
        entry = _no_photo_path(chat_id)
    _stamp(entry, _now() - PHOTO_TTL_S + FAILED_READ_RETRY_S)


def _read_held(chat_id: int, topic_id: int | None) -> bool:
    """Whether Telegram must not be read for this source right now."""
    return (channels.read_forbidden(chat_id, topic_id)
            or downloader.flood_gate.minutes_closed() > 0
            or safety.budget_exhausted())


async def _refresh(chat_id: int, topic_id: int | None) -> None:
    os.makedirs(PHOTOS_DIR, exist_ok=True)
    async with _read_slot:
        client = await tg.authorized_client()
        if not client or _read_held(chat_id, topic_id):   # things may have changed in the queue
            return
        try:
            photo = await tg.chat_photo(client, chat_id)
        except FloodWaitError as e:
            await downloader.flood_gate.trip(e.seconds)
            return
        except Exception as e:
            log.warning("reading the photo of %s failed: %s", chat_id, e)
            _retry_soon(chat_id)
            return
    if photo:
        _remember_photo(chat_id, photo)
        safety.record_download(len(photo))
    else:
        _remember_no_photo(chat_id)


def _shared_refresh(chat_id: int, topic_id: int | None) -> asyncio.Task:
    """The read in flight for this chat, or a new one: never two at once."""
    task = _reads_in_flight.get(chat_id)
    if task is None:
        task = asyncio.create_task(_refresh(chat_id, topic_id))
        _reads_in_flight[chat_id] = task
        task.add_done_callback(lambda _done: _reads_in_flight.pop(chat_id, None))
    return task


async def photo_of(channel: dict) -> bytes | None:
    """The photo to show for `channel`, or None when there is none to show. Refreshes
    a stale entry first when Telegram may be read; otherwise answers from the cache."""
    chat_id, topic_id = int(channel["chat_id"]), channel["topic_id"]
    if not _is_fresh(chat_id) and not _read_held(chat_id, topic_id):
        # shielded: a browser dropping the request must not abort the others waiting on it
        await asyncio.shield(_shared_refresh(chat_id, topic_id))
    return _cached(chat_id)
