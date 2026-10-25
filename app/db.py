# app/db.py — SQLite access layer (WAL, tuned pragmas, schema, indexes).
# Schema is backward-compatible with telearr v1, so an existing
# telearr.db imports cleanly (every CREATE ... IF NOT EXISTS is a no-op on it).
import sqlite3
import time
import logging
import contextlib
from .config import DB_PATH

_logger = logging.getLogger("db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,
  pw_hash  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL UNIQUE,
  title   TEXT NOT NULL,
  kind    TEXT NOT NULL DEFAULT 'tv',
  imdb_id TEXT,
  imdb_title TEXT,
  weekdays TEXT NOT NULL DEFAULT '0,1,2,3,4,5,6',
  poll_minutes INTEGER NOT NULL DEFAULT 10,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_scanned_at INTEGER DEFAULT 0,
  last_message_id INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS downloads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  file_unique_id TEXT,
  group_key TEXT,
  file_name  TEXT,
  file_size  INTEGER,
  save_path  TEXT,
  status TEXT NOT NULL,
  error  TEXT,
  progress REAL DEFAULT 0,
  speed_mbs REAL DEFAULT 0,
  started_at INTEGER,
  finished_at INTEGER,
  created_at INTEGER NOT NULL,
  retry_count INTEGER DEFAULT 0,
  UNIQUE(channel_id, message_id)
);
CREATE TABLE IF NOT EXISTS imdb_candidates (
  channel_id INTEGER NOT NULL,
  rank INTEGER NOT NULL,
  imdb_id TEXT NOT NULL,
  title TEXT, year INTEGER, kind TEXT,
  PRIMARY KEY (channel_id, rank)
);
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  channel_id INTEGER
);
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS releases (
  channel_id INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  group_key  TEXT,
  title      TEXT,
  season     INTEGER,
  episode    INTEGER,
  quality    TEXT,
  size       INTEGER,
  added_at   INTEGER NOT NULL,
  PRIMARY KEY (channel_id, message_id)
);
CREATE INDEX IF NOT EXISTS idx_rel_chan ON releases(channel_id);
CREATE INDEX IF NOT EXISTS idx_dl_chan_gk   ON downloads(channel_id, group_key);
CREATE INDEX IF NOT EXISTS idx_dl_status    ON downloads(status);
CREATE INDEX IF NOT EXISTS idx_logs_chan_id ON logs(channel_id, id);
"""


def _connect() -> sqlite3.Connection:
    c = sqlite3.connect(DB_PATH, timeout=30, check_same_thread=False)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL;")
    c.execute("PRAGMA synchronous=NORMAL;")
    c.execute("PRAGMA busy_timeout=30000;")
    return c


@contextlib.contextmanager
def conn():
    """`with db.conn() as c:` — commits on success, rolls back on error."""
    c = _connect()
    try:
        yield c
        c.commit()
    except Exception:
        c.rollback()
        raise
    finally:
        c.close()


# Lightweight migrations: CREATE TABLE IF NOT EXISTS won't add new columns to an
# existing table, so each (table, column, declaration) is added when missing.
# Append one line per new column; never reorder or remove entries.
COLUMN_MIGRATIONS = (
    ("downloads", "retry_count", "INTEGER DEFAULT 0"),
    ("channels", "language", "TEXT NOT NULL DEFAULT 'cat'"),
    ("channels", "fallback_quality", "TEXT NOT NULL DEFAULT '1080p'"),
    ("channels", "tvdb_id", "INTEGER"),      # series channels: Sonarr matches by TVDB id
    ("channels", "tmdb_id", "INTEGER"),
    ("releases", "parsed_episode", "INTEGER"),   # channel's own number when a part was resolved
    ("releases", "episode_source", "TEXT"),      # tmdb-ca | tmdb-en | sonarr | channel (kept)
)


def add_column_if_missing(c: sqlite3.Connection, table: str, column: str, decl: str) -> None:
    """Idempotent ALTER TABLE ... ADD COLUMN (identifiers come from code, never input)."""
    cols = {r[1] for r in c.execute(f"PRAGMA table_info({table})")}
    if column not in cols:
        c.execute(f"ALTER TABLE {table} ADD COLUMN {column} {decl}")


def init():
    with conn() as c:
        c.executescript(SCHEMA)
        for table, column, decl in COLUMN_MIGRATIONS:
            add_column_if_missing(c, table, column, decl)
        c.execute("PRAGMA wal_autocheckpoint=1000;")
        c.execute("PRAGMA wal_checkpoint(TRUNCATE);")  # shrink bloated WAL on boot
    _logger.info("db initialised at %s", DB_PATH)


def log(level: str, message: str, channel_id=None):
    """Persist an app event to the logs table (v1-compatible signature)."""
    try:
        with conn() as c:
            c.execute("INSERT INTO logs(ts,level,message,channel_id) VALUES(?,?,?,?)",
                      (int(time.time()), level, message, channel_id))
    except Exception as e:  # logging must never crash a download
        _logger.error("db.log failed: %s", e)
    _logger.log(getattr(logging, level.upper(), logging.INFO), message)
