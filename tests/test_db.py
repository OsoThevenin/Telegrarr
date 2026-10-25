"""Schema migrations: new channel columns appear on fresh and legacy databases."""
import sqlite3


def _channel_columns(dbfile):
    with sqlite3.connect(dbfile) as c:
        return {r[1]: r for r in c.execute("PRAGMA table_info(channels)")}


def test_fresh_db_channels_have_language_and_fallback_quality(fresh_db):
    cols = _channel_columns(fresh_db)

    assert "language" in cols
    assert "fallback_quality" in cols


def test_legacy_db_is_migrated_and_keeps_rows(tmp_path, monkeypatch):
    from app import config, db
    dbfile = str(tmp_path / "legacy.db")
    with sqlite3.connect(dbfile) as c:
        c.execute("""CREATE TABLE channels (id INTEGER PRIMARY KEY AUTOINCREMENT,
                     chat_id INTEGER NOT NULL UNIQUE, title TEXT NOT NULL,
                     kind TEXT NOT NULL DEFAULT 'tv', created_at INTEGER NOT NULL)""")
        c.execute("INSERT INTO channels(chat_id,title,created_at) VALUES(-1,'Old',0)")
    monkeypatch.setattr(config, "DB_PATH", dbfile, raising=False)
    monkeypatch.setattr(db, "DB_PATH", dbfile, raising=False)

    db.init()
    db.init()  # idempotent

    with db.conn() as c:
        row = c.execute("SELECT * FROM channels WHERE chat_id=-1").fetchone()
    assert row["language"] == "cat"
    assert row["fallback_quality"] == "1080p"
