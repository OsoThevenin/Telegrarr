"""Scans and the FloodWait gate: polls hold while it is closed, and a FloodWait met
while scanning closes it for every other Telegram read.

Driven over HTTP (``arr_app``) with Telegram faked at the client (``FakeTelegram``).
"""
import asyncio

import pytest

from app import downloader
from app.safety import FloodGate
from http_harness import eventually

CHAT = -1007600000001
OTHER_CHAT = -1007600000002
SHOW = "The Show"
FLOOD_S = 120
SOME_TICKS_S = 0.1


class Gate:
    """The shared flood gate on a clock the test moves."""

    def __init__(self):
        self.now = 1_000_000.0
        self.gate = FloodGate(clock=lambda: self.now)

    def open(self) -> None:
        self.now += FLOOD_S + 1


@pytest.fixture()
def flood(monkeypatch):
    gate = Gate()
    monkeypatch.setattr(downloader, "flood_gate", gate.gate)
    return gate


async def _source(arr_app, chat_id, title):
    arr_app.telegram.add_channel(chat_id, title)
    source = await arr_app.add_channel(chat_id)
    arr_app.post_episodes(chat_id, title, [1])
    return source


async def _failed_scans(arr_app) -> list[str]:
    logs = (await arr_app.http.get("/api/logs")).raise_for_status().json()
    return [e["message"] for e in logs if e["level"] == "ERROR"]


@pytest.mark.asyncio
async def test_a_poll_reads_nothing_while_the_gate_is_closed_and_catches_up_after(
        arr_app, polling, flood):
    await _source(arr_app, CHAT, SHOW)
    await flood.gate.trip(FLOOD_S)
    reads = arr_app.telegram.reads_of(CHAT)

    async with polling():
        await asyncio.sleep(SOME_TICKS_S)
        while_closed = arr_app.telegram.reads_of(CHAT)
        flood.open()
        await arr_app.episode_url(SHOW, 1)

    assert while_closed == reads


@pytest.mark.asyncio
async def test_a_flood_wait_while_polling_stops_the_pass_and_the_source_is_read_again(
        arr_app, polling, flood):
    tg = arr_app.telegram
    await _source(arr_app, CHAT, SHOW)
    await _source(arr_app, OTHER_CHAT, "Other")           # newer: polled first in each pass
    other_reads = tg.reads_of(OTHER_CHAT)
    reads = tg.reads_of(CHAT)
    tg.flood_seconds, tg.flood_on_next_read = FLOOD_S, True

    async with polling():
        await asyncio.sleep(SOME_TICKS_S)
        while_closed = tg.reads_of(CHAT), tg.reads_of(OTHER_CHAT)
        flood.open()
        await arr_app.episode_url(SHOW, 1)
        await arr_app.episode_url("Other", 1)

    assert while_closed == (reads, other_reads + 1)
    assert await _failed_scans(arr_app) == []


@pytest.mark.asyncio
async def test_a_flood_wait_retrying_a_failed_transfer_holds_the_retries(arr_app, polling, flood):
    tg = arr_app.telegram
    file_name = "The.Show.S01E01.mkv"
    source = await _source(arr_app, CHAT, SHOW)
    await arr_app.scan(source["id"])
    url = await arr_app.episode_url(SHOW, 1)
    tg.channels[CHAT].payloads.clear()                    # the file can't be fetched
    await arr_app.grab(url)

    async def failed():
        row = await arr_app.download(file_name)
        return row if row and row["status"] == "failed" else None

    before = (await eventually(failed))["retry_count"]
    tg.flood_seconds, tg.flood_on_next_message = FLOOD_S, True

    async def retried():
        row = await arr_app.download(file_name)
        return row if row["retry_count"] > before else None

    async with polling():
        await asyncio.sleep(SOME_TICKS_S)
        while_closed = (await arr_app.download(file_name))["retry_count"]
        flood.open()
        await eventually(retried)

    assert while_closed == before


@pytest.mark.asyncio
@pytest.mark.parametrize("url", ["/api/channels/{id}/scan", "/api/system/tasks/scan_all"])
async def test_a_scan_asked_for_while_the_gate_is_closed_is_refused(arr_app, flood, url):
    source = await _source(arr_app, CHAT, SHOW)
    await flood.gate.trip(FLOOD_S)
    reads = arr_app.telegram.reads_of(CHAT)

    r = await arr_app.http.post(url.format(id=source["id"]))

    assert r.status_code == 429
    assert r.json()["detail"]["key"] == "err.scan.rate_limit_active"
    assert r.json()["detail"]["params"]["minutes"] == 2
    assert arr_app.telegram.reads_of(CHAT) == reads
