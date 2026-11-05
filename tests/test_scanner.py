"""Cross-channel (per-show) download de-duplication."""
import pytest

pytest.importorskip("telethon")


def _add_channel(db, chat_id, title, imdb_id="", imdb_title=""):
    with db.conn() as c:
        cur = c.execute(
            "INSERT INTO channels (chat_id,title,kind,imdb_id,imdb_title,created_at) "
            "VALUES (?,?,?,?,?,?)", (chat_id, title, "tv", imdb_id, imdb_title, 0))
        return c.execute("SELECT * FROM channels WHERE id=?", (cur.lastrowid,)).fetchone()


def _add_completed(db, channel_id, gk, size=1000):
    with db.conn() as c:
        c.execute(
            "INSERT INTO downloads (channel_id,message_id,group_key,file_name,file_size,"
            "save_path,status,created_at) VALUES (?,?,?,?,?,?,?,?)",
            (channel_id, hash(gk) % 100000, gk, gk + ".mp4", size, "/m/" + gk + ".mp4", "completed", 0))


def test_dedup_spans_channels_sharing_imdb_id(fresh_db):
    from app import db, scanner
    a = _add_channel(db, -1, "Source A", imdb_id="tt1", imdb_title="Show")
    b = _add_channel(db, -2, "Source B", imdb_id="tt1", imdb_title="Show (2008)")  # same id, diff title
    _add_completed(db, a["id"], "S01E01")
    # B shares the imdb_id → already have E01 that A grabbed; E02 is still new
    assert scanner._already_have(b, "S01E01", 1000) is True
    assert scanner._already_have(b, "S01E02", 1000) is False


def test_dedup_spans_channels_sharing_imdb_title(fresh_db):
    from app import db, scanner
    a = _add_channel(db, -1, "A", imdb_title="My Show")
    b = _add_channel(db, -2, "B", imdb_title="My Show")
    _add_completed(db, a["id"], "S02E05")
    assert scanner._already_have(b, "S02E05", 1000) is True


def test_unmapped_channels_stay_independent(fresh_db):
    from app import db, scanner
    a = _add_channel(db, -1, "A")  # no imdb mapping
    b = _add_channel(db, -2, "B")
    _add_completed(db, a["id"], "S01E01")
    # unmapped → per-channel dedup, so B does NOT see A's download
    assert scanner._already_have(b, "S01E01", 1000) is False
    assert scanner._already_have(a, "S01E01", 1000) is True


def test_larger_replacement_not_deduped(fresh_db):
    from app import db, scanner
    a = _add_channel(db, -1, "A", imdb_id="tt9")
    b = _add_channel(db, -2, "B", imdb_id="tt9")
    _add_completed(db, a["id"], "S01E01", size=1000)
    # a bigger file for the same episode is allowed through (quality upgrade)
    assert scanner._already_have(b, "S01E01", 5000) is False


def test_retry_failed_requeues_and_bounds(fresh_db, monkeypatch):
    import asyncio
    from app import db, scanner, transfers

    ch = _add_channel(db, -1, "A", imdb_id="tt1")
    with db.conn() as c:
        # one retryable failure (rc=0), one exhausted (rc=MAX)
        c.execute("INSERT INTO downloads (channel_id,message_id,group_key,file_name,file_size,"
                  "save_path,status,created_at,retry_count) VALUES (?,?,?,?,?,?,?,?,?)",
                  (ch["id"], 5, "S01E01", "a.mp4", 1000, "/m/a.mp4", "failed", 0, 0))
        c.execute("INSERT INTO downloads (channel_id,message_id,group_key,file_name,file_size,"
                  "save_path,status,created_at,retry_count) VALUES (?,?,?,?,?,?,?,?,?)",
                  (ch["id"], 6, "S01E02", "b.mp4", 1000, "/m/b.mp4", "failed", 0,
                   scanner.MAX_DOWNLOAD_RETRIES))

    class FakeClient:
        async def get_messages(self, chat, ids=None):
            return object()  # truthy message

    monkeypatch.setattr(transfers, "spawn", lambda coro: coro.close())
    asyncio.run(scanner._retry_failed(FakeClient(), ch))

    with db.conn() as c:
        a = c.execute("SELECT status, retry_count FROM downloads WHERE message_id=5").fetchone()
        b = c.execute("SELECT status, retry_count FROM downloads WHERE message_id=6").fetchone()
    assert a["status"] == "queued" and a["retry_count"] == 1   # retried, counter bumped
    assert b["status"] == "failed" and b["retry_count"] == scanner.MAX_DOWNLOAD_RETRIES  # exhausted
