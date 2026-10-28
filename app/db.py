# app/db.py — SQLite access layer (WAL, tuned pragmas, schema, indexes).
# Schema is backward-compatible with telearr v1, so an existing
# telearr.db imports cleanly (every CREATE ... IF NOT EXISTS is a no-op on it).
import json
import sqlite3
import time
import logging
import contextlib
from .config import DB_PATH, POLL_FLOOR_MINUTES
from .i18n import translate
from .namer import DEFAULT_FALLBACK_QUALITY

_logger = logging.getLogger("db")

# A source (the `channels` table) is unique by (chat_id, topic_id): a NULL topic_id
# is the whole chat. SQLite treats NULLs as distinct in UNIQUE, hence IFNULL (topic
# ids are message ids, so never 0). Databases from before topics had an inline
# UNIQUE(chat_id); `_rebuild_channels_without_inline_unique` lifts it.
CHANNELS_TABLE = f"""
CREATE TABLE IF NOT EXISTS {{name}} (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  title   TEXT NOT NULL,
  kind    TEXT NOT NULL DEFAULT 'tv',
  imdb_id TEXT,
  imdb_title TEXT,
  weekdays TEXT NOT NULL DEFAULT '0,1,2,3,4,5,6',
  poll_minutes INTEGER NOT NULL DEFAULT {POLL_FLOOR_MINUTES},
  enabled INTEGER NOT NULL DEFAULT 1,
  last_scanned_at INTEGER DEFAULT 0,
  last_message_id INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);
"""
SOURCE_UNIQUE_INDEX = ("CREATE UNIQUE INDEX IF NOT EXISTS idx_channels_source "
                       "ON channels(chat_id, IFNULL(topic_id, 0))")

SCHEMA = CHANNELS_TABLE.format(name="channels") + """
CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,
  pw_hash  TEXT NOT NULL
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
CREATE TABLE IF NOT EXISTS pending_review (
  channel_id INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  parsed_title TEXT,
  year       INTEGER,
  quality    TEXT,
  file_name  TEXT,
  caption    TEXT,
  size       INTEGER,
  group_key  TEXT,
  reason     TEXT,
  status     TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
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
    ("channels", "fallback_quality", f"TEXT NOT NULL DEFAULT '{DEFAULT_FALLBACK_QUALITY}'"),
    ("channels", "tvdb_id", "INTEGER"),      # series channels: Sonarr matches by TVDB id
    ("channels", "tmdb_id", "INTEGER"),
    ("channels", "year", "INTEGER"),         # series premiere year, in the release title for name-matching
    ("releases", "parsed_episode", "INTEGER"),   # channel's own number when a part was resolved
    ("releases", "episode_source", "TEXT"),      # tmdb-ca | tmdb-en | sonarr | channel (kept)
    ("releases", "movie_tmdb_id", "INTEGER"),  # movie channels: ids per message, not per channel
    ("releases", "movie_imdb_id", "TEXT"),
    ("releases", "year", "INTEGER"),
    ("logs", "msg_key", "TEXT"),             # i18n key of the event (NULL on rows from older versions)
    ("logs", "msg_params", "TEXT"),          # its params, JSON
    ("downloads", "error_key", "TEXT"),      # i18n key of `error` (which stays English for SABnzbd)
    ("downloads", "error_params", "TEXT"),
    ("channels", "topic_id", "INTEGER"),     # forum topic sources: the topic's id (NULL: whole chat)
    ("channels", "topic_title", "TEXT"),
    ("channels", "forum", "INTEGER NOT NULL DEFAULT 0"),   # 1: the chat is a forum group
    ("downloads", "arr_hidden", "INTEGER NOT NULL DEFAULT 0"),  # 1: deleted from *arr history
    ("downloads", "attempt", "INTEGER NOT NULL DEFAULT 0"),  # +1 per re-queue of a stopped row
    ("releases", "movie_title", "TEXT"),     # movie channels: the film's display title (Catalan first)
)

# download row statuses, grouped by what the code asks of a row
ACTIVE_STATUSES = ("queued", "downloading")      # waiting for or holding a download task
STOPPED_STATUSES = ("failed", "cancelled")       # re-queuing one of these starts a new attempt
FINISHED_STATUSES = ("completed", *STOPPED_STATUSES)   # an *arr history delete hides these
HISTORY_STATUSES = ("completed", "failed")       # what the SABnzbd history reports
_TEXT_LANG = "en"     # language of the plain-text column kept next to a key


def add_column_if_missing(c: sqlite3.Connection, table: str, column: str, decl: str) -> None:
    """Idempotent ALTER TABLE ... ADD COLUMN (identifiers come from code, never input)."""
    cols = {r[1] for r in c.execute(f"PRAGMA table_info({table})")}
    if column not in cols:
        c.execute(f"ALTER TABLE {table} ADD COLUMN {column} {decl}")


def _has_inline_unique_chat_id(c: sqlite3.Connection) -> bool:
    """True for a channels table created before topic sources (UNIQUE on chat_id alone)."""
    return any(idx["origin"] == "u" for idx in c.execute("PRAGMA index_list(channels)"))


def _rebuild_channels_without_inline_unique(c: sqlite3.Connection) -> None:
    """SQLite can't drop an inline UNIQUE: copy channels (ids included) into a new table."""
    if not _has_inline_unique_chat_id(c):
        return
    c.execute("DROP TABLE IF EXISTS channels_rebuild")
    c.execute(CHANNELS_TABLE.format(name="channels_rebuild"))
    for table, column, decl in COLUMN_MIGRATIONS:
        if table == "channels":
            add_column_if_missing(c, "channels_rebuild", column, decl)
    cols = ",".join(r[1] for r in c.execute("PRAGMA table_info(channels)"))
    c.execute(f"INSERT INTO channels_rebuild ({cols}) SELECT {cols} FROM channels")
    c.execute("DROP TABLE channels")
    c.execute("ALTER TABLE channels_rebuild RENAME TO channels")
    _logger.info("channels table rebuilt: sources are now unique by (chat, topic)")


def init():
    with conn() as c:
        c.executescript(SCHEMA)
        for table, column, decl in COLUMN_MIGRATIONS:
            add_column_if_missing(c, table, column, decl)
        _rebuild_channels_without_inline_unique(c)
        c.execute(SOURCE_UNIQUE_INDEX)
        c.commit()  # a checkpoint can't run inside the rebuild's transaction
        c.execute("PRAGMA wal_autocheckpoint=1000;")
        c.execute("PRAGMA wal_checkpoint(TRUNCATE);")  # shrink bloated WAL on boot
    _logger.info("db initialised at %s", DB_PATH)


def placeholders(values) -> str:
    """``?,?,…`` for an SQL ``IN (…)`` over ``values``."""
    return ",".join("?" * len(values))


def keyed(m: str | dict | None) -> tuple[str | None, str | None, str | None]:
    """(English text, key, JSON params) to store for a plain string or an
    i18n message ``{"key", "params"}``; key and params are None for plain text."""
    if not isinstance(m, dict):
        return m, None, None
    params = m.get("params") or {}
    return translate(m["key"], _TEXT_LANG, **params), m["key"], json.dumps(params)


def stored_message(key: str | None, params: str | None) -> dict | None:
    """The ``{"key", "params"}`` message a row stored with :func:`keyed`, or None."""
    if not key:
        return None
    try:
        decoded = json.loads(params) if params else {}
    except ValueError:
        decoded = {}
    return {"key": key, "params": decoded if isinstance(decoded, dict) else {}}


def log(level: str, message: str | dict, channel_id=None):
    """Persist an app event to the logs table.

    ``message`` is an i18n message (``i18n.message(...)``), shown in the UI
    language, or plain text (third-party text)."""
    text, key, params = keyed(message)
    try:
        with conn() as c:
            c.execute("INSERT INTO logs(ts,level,message,channel_id,msg_key,msg_params) VALUES(?,?,?,?,?,?)",
                      (int(time.time()), level, text, channel_id, key, params))
    except Exception as e:  # logging must never crash a download
        _logger.error("db.log failed: %s", e)
    _logger.log(getattr(logging, level.upper(), logging.INFO), text)
