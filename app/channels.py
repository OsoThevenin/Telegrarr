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


# Columns a user may edit on an existing channel (PATCH /api/channels/{id}).
EDITABLE = frozenset({"title", "kind", "weekdays", "poll_minutes", "enabled", "imdb_id",
                      "imdb_title", "language", "fallback_quality"})


def get(cid: int) -> dict | None:
    """Channel `cid`'s row, or None when it does not exist."""
    with db.conn() as c:
        row = c.execute("SELECT * FROM channels WHERE id=?", (cid,)).fetchone()
    return dict(row) if row else None


def listed(*, enabled_only: bool = False) -> list[dict]:
    """Every channel (newest first), or only the enabled ones."""
    where = " WHERE enabled=1" if enabled_only else ""
    with db.conn() as c:
        return [dict(r) for r in c.execute(f"SELECT * FROM channels{where} ORDER BY id DESC")]


def update(cid: int, fields: dict) -> dict | None:
    """Apply the EDITABLE `fields` to channel `cid`; returns its row (None if missing)."""
    changes = {k: v for k, v in fields.items() if k in EDITABLE}
    if changes:
        assignments = ",".join(f"{k}=?" for k in changes)
        with db.conn() as c:
            c.execute(f"UPDATE channels SET {assignments} WHERE id=?", (*changes.values(), cid))
    return get(cid)


def delete(cid: int) -> None:
    with db.conn() as c:
        c.execute("DELETE FROM channels WHERE id=?", (cid,))


def series_title(imdb_id: str) -> str:
    """The display title stored with a channel mapped to `imdb_id` ('' if none)."""
    with db.conn() as c:
        row = c.execute("SELECT imdb_title FROM channels WHERE imdb_id=? LIMIT 1", (imdb_id,)).fetchone()
    return (row["imdb_title"] if row else "") or ""


def existing_chat_ids() -> dict[int, int]:
    """chat_id -> channel id of every whole-chat source already added (topic sources
    don't count: adding one topic of a group doesn't add the group)."""
    with db.conn() as c:
        return {r["chat_id"]: r["id"]
                for r in c.execute("SELECT id, chat_id FROM channels WHERE topic_id IS NULL")}


def _source_id(c, chat_id: int, topic_id: int | None) -> int | None:
    """Id of the source for (chat, topic) — topic None is the whole chat — if added."""
    row = c.execute("SELECT id FROM channels WHERE chat_id=? AND topic_id IS ?",
                    (chat_id, topic_id)).fetchone()
    return row["id"] if row else None


def upsert(chat_id: int, title: str, *, kind: str = "tv", weekdays: str = ALL_WEEKDAYS,
           poll_minutes: int, release: dict | None = None,
           topic_id: int | None = None, topic_title: str | None = None,
           forum: bool | None = None) -> dict:
    """Add the source for (chat, topic), or re-add it in place (same id, scan progress
    and series mapping kept; given settings win). `forum`: whether the chat is a
    forum group (None: unknown, the stored flag is kept). Returns its row."""
    release = release or {}
    language, fallback = release.get("language"), release.get("fallback_quality")
    forum_flag = None if forum is None else int(bool(forum))
    with db.conn() as c:
        cid = _source_id(c, chat_id, topic_id)
        if cid is None:
            cid = c.execute("""INSERT INTO channels
               (chat_id,topic_id,topic_title,title,kind,weekdays,poll_minutes,enabled,created_at,
                language,fallback_quality,forum)
               VALUES(?,?,?,?,?,?,?,1,?,?,?,?)""",
               (chat_id, topic_id, topic_title, title, kind, weekdays, poll_minutes,
                int(time.time()), language or DEFAULT_LANGUAGE,
                fallback or DEFAULT_FALLBACK_QUALITY, forum_flag or 0)).lastrowid
        else:
            c.execute("""UPDATE channels SET title=?, kind=?, weekdays=?, poll_minutes=?, enabled=1,
                           topic_title=COALESCE(?, topic_title),
                           language=COALESCE(?, language),
                           fallback_quality=COALESCE(?, fallback_quality),
                           forum=COALESCE(?, forum)
                         WHERE id=?""",
                      (title, kind, weekdays, poll_minutes, topic_title, language, fallback,
                       forum_flag, cid))
        return dict(c.execute("SELECT * FROM channels WHERE id=?", (cid,)).fetchone())


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
