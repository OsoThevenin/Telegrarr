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


def test_legacy_downloads_gain_the_arr_columns_and_keep_rows(tmp_path, monkeypatch):
    from app import config, db
    dbfile = str(tmp_path / "legacy.db")
    with sqlite3.connect(dbfile) as c:   # a downloads table from before error keys, the flag and attempts
        c.execute("""CREATE TABLE channels (id INTEGER PRIMARY KEY AUTOINCREMENT,
                     chat_id INTEGER NOT NULL UNIQUE, title TEXT NOT NULL,
                     kind TEXT NOT NULL DEFAULT 'tv', created_at INTEGER NOT NULL)""")
        c.execute("""CREATE TABLE downloads (id INTEGER PRIMARY KEY AUTOINCREMENT,
                     channel_id INTEGER NOT NULL, message_id INTEGER NOT NULL,
                     file_unique_id TEXT, group_key TEXT, file_name TEXT, file_size INTEGER,
                     save_path TEXT, status TEXT NOT NULL, error TEXT, progress REAL DEFAULT 0,
                     speed_mbs REAL DEFAULT 0, started_at INTEGER, finished_at INTEGER,
                     created_at INTEGER NOT NULL, UNIQUE(channel_id, message_id))""")
        c.execute("""INSERT INTO downloads(channel_id,message_id,file_name,save_path,status,error,created_at)
                     VALUES(1,7,'Old.S01E01.mkv','/tv/Old.S01E01.mkv','failed','boom',0)""")
    monkeypatch.setattr(config, "DB_PATH", dbfile, raising=False)
    monkeypatch.setattr(db, "DB_PATH", dbfile, raising=False)

    db.init()
    db.init()  # idempotent

    with db.conn() as c:
        rows = [dict(r) for r in c.execute("SELECT * FROM downloads")]
    assert len(rows) == 1
    assert (rows[0]["arr_hidden"], rows[0]["attempt"]) == (0, 0)
    assert (rows[0]["file_name"], rows[0]["status"], rows[0]["error"]) == ("Old.S01E01.mkv", "failed", "boom")


def test_a_channel_stored_without_a_poll_interval_polls_at_the_floor(fresh_db):
    from app import config, db
    with db.conn() as c:
        c.execute("INSERT INTO channels(chat_id,title,created_at) VALUES(-2,'No poll given',0)")
        row = c.execute("SELECT poll_minutes FROM channels WHERE chat_id=-2").fetchone()

    assert row["poll_minutes"] == config.POLL_FLOOR_MINUTES == 15
