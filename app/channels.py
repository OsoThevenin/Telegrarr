# app/channels.py — source-channel rows: creation and series-id mapping.
# Shared by the channel API and the directory mass import so both create and map
# channels the same way.
import time

from . import db, settings, tmdb
from .namer import DEFAULT_LANGUAGE, DEFAULT_FALLBACK_QUALITY

ALL_WEEKDAYS = "0,1,2,3,4,5,6"


def default_poll_minutes() -> int:
    """The configured default poll interval (floor already enforced by settings)."""
    return settings.get_int("default_poll_minutes", settings.DEFAULTS["default_poll_minutes"])


def existing_chat_ids() -> dict[int, int]:
    """chat_id -> channel id of every source channel already added."""
    with db.conn() as c:
        return {r["chat_id"]: r["id"] for r in c.execute("SELECT id, chat_id FROM channels")}


def upsert(chat_id: int, title: str, *, kind: str = "tv", weekdays: str = ALL_WEEKDAYS,
           poll_minutes: int, release: dict | None = None) -> dict:
    """Insert (or re-add, keeping scan progress and ids) a source channel; returns its row."""
    release = release or {}
    with db.conn() as c:
        c.execute("""INSERT OR REPLACE INTO channels
           (chat_id,title,kind,weekdays,poll_minutes,enabled,created_at,
            last_message_id,last_scanned_at,imdb_id,imdb_title,
            language,fallback_quality)
           VALUES(?,?,?,?,?,1,?,
             COALESCE((SELECT last_message_id FROM channels WHERE chat_id=?),0),
             COALESCE((SELECT last_scanned_at FROM channels WHERE chat_id=?),0),
             (SELECT imdb_id FROM channels WHERE chat_id=?),
             (SELECT imdb_title FROM channels WHERE chat_id=?),
             COALESCE(?, (SELECT language FROM channels WHERE chat_id=?), ?),
             COALESCE(?, (SELECT fallback_quality FROM channels WHERE chat_id=?), ?))""",
           (chat_id, title, kind, weekdays, poll_minutes, int(time.time()),
            chat_id, chat_id, chat_id, chat_id,
            release.get("language"), chat_id, DEFAULT_LANGUAGE,
            release.get("fallback_quality"), chat_id, DEFAULT_FALLBACK_QUALITY))
        return dict(c.execute("SELECT * FROM channels WHERE chat_id=?", (chat_id,)).fetchone())


def store_series_ids(cid: int, ids: tmdb.SeriesIds, title: str = "") -> dict | None:
    """Store derived series ids on channel `cid` (display title: `title`, else TMDB's)."""
    display = (title or "").strip() or ids.title
    with db.conn() as c:
        c.execute("""UPDATE channels SET tvdb_id=?, tmdb_id=?, imdb_id=?,
                     imdb_title=COALESCE(NULLIF(?, ''), imdb_title) WHERE id=?""",
                  (ids.tvdb_id, ids.tmdb_id, ids.imdb_id, display, cid))
        row = c.execute("SELECT * FROM channels WHERE id=?", (cid,)).fetchone()
    return dict(row) if row else None


async def map_series(cid: int, *, tmdb_id=None, tvdb_id=None, title: str = "") -> dict | None:
    """Map channel `cid` to its series: derive TVDB/TMDB/IMDb ids via TMDB (a typed
    TVDB id wins) and store them. Returns the updated row, or None if the channel
    does not exist. Raises tmdb.TMDBError when the ids cannot be derived."""
    return store_series_ids(cid, await tmdb.series_ids(tmdb_id, tvdb_id), title)
