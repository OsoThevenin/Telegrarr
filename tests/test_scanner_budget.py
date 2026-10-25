"""Downloads pause (stay queued, with a visible reason) while the daily budget is used up."""
import asyncio
from types import SimpleNamespace

import pytest

pytest.importorskip("telethon")

from app import db, safety, scanner, settings  # noqa: E402

FILE_SIZE = 4096


class FakeClient:
    """Just enough Telethon surface for the sequential fallback download."""

    def __init__(self):
        self.downloads = 0

    async def download_media(self, message, file, progress_callback=None):
        self.downloads += 1
        with open(file, "wb") as fh:
            fh.write(b"x" * message.document.size)


def _message(msg_id=7):
    doc = SimpleNamespace(id=1, access_hash=2, file_reference=b"", dc_id=2, size=FILE_SIZE)
    return SimpleNamespace(id=msg_id, document=doc, video=None, chat_id=-100, message="Show S01E01")


def _seed(save_path, msg_id=7):
    with db.conn() as c:
        cid = c.execute("INSERT INTO channels (chat_id,title,kind,created_at) VALUES (-100,'Show','tv',0)").lastrowid
        c.execute("INSERT INTO downloads (channel_id,message_id,group_key,file_name,file_size,save_path,"
                  "status,created_at) VALUES (?,?,?,?,?,?,'queued',0)",
                  (cid, msg_id, "S01E01", "f.mkv", FILE_SIZE, save_path))
    return cid


def _row(cid):
    with db.conn() as c:
        return c.execute("SELECT status, error FROM downloads WHERE channel_id=?", (cid,)).fetchone()


@pytest.fixture()
def quiet(fresh_db, monkeypatch):
    settings.set("min_free_gb", "0")
    monkeypatch.setattr(scanner, "BUDGET_RECHECK_SECONDS", 0.01)
    monkeypatch.setattr(scanner, "_sem", asyncio.Semaphore(1))
    monkeypatch.setattr(scanner, "_inflight", set())


@pytest.mark.asyncio
async def test_exhausted_budget_keeps_download_queued_with_reason(quiet, tmp_path):
    settings.apply({"daily_budget_gb": 1})
    safety.record_download(safety.GB)
    save = str(tmp_path / "out" / "f.mkv")
    cid = _seed(save)
    client = FakeClient()

    task = asyncio.create_task(scanner._run_download(client, cid, _message(), save, "S01E01"))
    await asyncio.sleep(0.05)

    row = _row(cid)
    assert row["status"] == "queued"
    assert "budget" in (row["error"] or "").lower()
    assert client.downloads == 0
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task


@pytest.mark.asyncio
async def test_download_resumes_when_budget_frees_up(quiet, tmp_path):
    settings.apply({"daily_budget_gb": 1})
    safety.record_download(safety.GB)
    save = str(tmp_path / "out" / "f.mkv")
    cid = _seed(save)
    client = FakeClient()

    task = asyncio.create_task(scanner._run_download(client, cid, _message(), save, "S01E01"))
    await asyncio.sleep(0.05)
    settings.apply({"daily_budget_gb": 0})        # as if the day rolled over / limit lifted
    await asyncio.wait_for(task, timeout=2)

    row = _row(cid)
    assert row["status"] == "completed"
    assert row["error"] is None
    assert client.downloads == 1


@pytest.mark.asyncio
async def test_completed_download_counts_toward_budget(quiet, tmp_path):
    save = str(tmp_path / "out" / "f.mkv")
    cid = _seed(save)

    await scanner._run_download(FakeClient(), cid, _message(), save, "S01E01")

    assert safety.budget_status()["used_bytes"] == FILE_SIZE
