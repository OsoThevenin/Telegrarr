# app/movies.py — movie channels: per-message film matching + the Pending review queue.
#
# A movie channel posts many films. Each media message's title and year are
# parsed and looked up on TMDB; a confident match is indexed as a release that
# carries the film's TMDB/IMDb ids (so Radarr finds it by id). Anything else is
# held in `pending_review` — never offered to Radarr — until the user assigns a
# film (which indexes it) or discards it (which hides it for good).
import time
from dataclasses import dataclass

from . import db, tmdb
from .namer import release_name, DEFAULT_LANGUAGE

REASON_NO_YEAR = "No year in the title"
REASON_NO_MATCH = "No confident TMDB match"
STATUS_PENDING, STATUS_DISCARDED = "pending", "discarded"


class ReviewError(Exception):
    """A review action could not be applied; the message is safe to show."""


class NotPending(ReviewError):
    def __init__(self):
        super().__init__("This message is not waiting for review")


@dataclass(frozen=True)
class PostedFilm:
    """A movie channel's media message, as parsed from its caption/file name."""
    channel_id: int
    message_id: int
    group_key: str
    size: int
    file_name: str
    caption: str
    title: str
    year: int | None
    quality: str | None


def _channel(c, channel_id: int):
    return c.execute("SELECT * FROM channels WHERE id=?", (channel_id,)).fetchone()


def _index_film(c, channel, posted_key: tuple[int, int], group_key: str, film: tmdb.Film,
                quality: str | None, size: int) -> str:
    title = release_name(film.title, 0, 0, quality or "", "movie",
                         language=channel["language"] or DEFAULT_LANGUAGE, year=film.year)
    c.execute("""INSERT INTO releases
        (channel_id,message_id,group_key,title,season,episode,quality,size,added_at,
         movie_tmdb_id,movie_imdb_id,year)
        VALUES(?,?,?,?,NULL,NULL,?,?,?,?,?,?)
        ON CONFLICT(channel_id,message_id) DO UPDATE SET
          title=excluded.title, quality=excluded.quality, size=excluded.size,
          movie_tmdb_id=excluded.movie_tmdb_id, movie_imdb_id=excluded.movie_imdb_id, year=excluded.year""",
        (*posted_key, group_key, title, quality, size, int(time.time()),
         film.tmdb_id, film.imdb_id, film.year))
    return title


def _known(channel_id: int, message_id: int) -> tuple[bool, bool]:
    """(indexed as a release, held/discarded in review) for a message."""
    key = (channel_id, message_id)
    with db.conn() as c:
        indexed = c.execute("SELECT 1 FROM releases WHERE channel_id=? AND message_id=?", key).fetchone()
        reviewed = c.execute("SELECT 1 FROM pending_review WHERE channel_id=? AND message_id=?", key).fetchone()
    return bool(indexed), bool(reviewed)


def _hold(posted: PostedFilm, reason: str) -> None:
    with db.conn() as c:
        c.execute("""INSERT OR IGNORE INTO pending_review
            (channel_id,message_id,parsed_title,year,quality,file_name,caption,size,group_key,
             reason,status,created_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
            (posted.channel_id, posted.message_id, posted.title, posted.year, posted.quality,
             posted.file_name, posted.caption, posted.size, posted.group_key, reason,
             STATUS_PENDING, int(time.time())))
    db.log("INFO", f"Pending review: {posted.file_name} ({reason})", channel_id=posted.channel_id)


async def _lookup(posted: PostedFilm) -> tuple[tmdb.Film | None, str]:
    if not posted.year:
        return None, REASON_NO_YEAR
    try:
        film = await tmdb.match_film(posted.title, posted.year)
    except tmdb.TMDBError as e:
        return None, f"TMDB lookup failed: {e}"
    return film, REASON_NO_MATCH


async def index_message(posted: PostedFilm) -> bool:
    """Match a movie channel message to its film. True when it is offered to Radarr."""
    indexed, reviewed = _known(posted.channel_id, posted.message_id)
    if indexed or reviewed:
        return indexed
    film, reason = await _lookup(posted)
    if film is None:
        _hold(posted, reason)
        return False
    with db.conn() as c:
        channel = _channel(c, posted.channel_id)
        _index_film(c, channel, (posted.channel_id, posted.message_id), posted.group_key,
                    film, posted.quality, posted.size)
    return True


# ── Pending review ────────────────────────────────────────────────────
def pending() -> list[dict]:
    """Messages waiting for review, newest first, with their channel title."""
    with db.conn() as c:
        rows = c.execute("""SELECT p.*, ch.title AS channel_title FROM pending_review p
                            JOIN channels ch ON ch.id = p.channel_id
                            WHERE p.status=? ORDER BY p.created_at DESC, p.message_id DESC""",
                         (STATUS_PENDING,)).fetchall()
    return [dict(r) for r in rows]


def _pending_row(c, channel_id: int, message_id: int):
    row = c.execute("SELECT * FROM pending_review WHERE channel_id=? AND message_id=? AND status=?",
                    (channel_id, message_id, STATUS_PENDING)).fetchone()
    if not row:
        raise NotPending()
    return row


async def _film_for(tmdb_id=None, imdb_id=None) -> tmdb.Film:
    if tmdb_id not in (None, ""):
        return await tmdb.film(tmdb_id)
    if imdb_id not in (None, ""):
        return await tmdb.film_for_imdb(imdb_id)
    raise ReviewError("Pick a film from the TMDB search or enter its TMDB or IMDb id")


async def assign(channel_id: int, message_id: int, tmdb_id=None, imdb_id=None) -> dict:
    """Attach a film to a pending message and offer it to Radarr."""
    with db.conn() as c:
        _pending_row(c, channel_id, message_id)
    try:
        film = await _film_for(tmdb_id, imdb_id)
    except tmdb.TMDBError as e:
        raise ReviewError(str(e)) from e
    with db.conn() as c:
        row = _pending_row(c, channel_id, message_id)
        title = _index_film(c, _channel(c, channel_id), (channel_id, message_id), row["group_key"],
                            film, row["quality"], row["size"] or 0)
        c.execute("DELETE FROM pending_review WHERE channel_id=? AND message_id=?", (channel_id, message_id))
    db.log("INFO", f"Review: assigned {row['file_name']} → {title}", channel_id=channel_id)
    return {"title": title, "tmdb_id": film.tmdb_id, "imdb_id": film.imdb_id, "year": film.year}


def discard(channel_id: int, message_id: int) -> None:
    """Hide a pending message for good (rescans and backfills keep skipping it)."""
    with db.conn() as c:
        row = _pending_row(c, channel_id, message_id)
        c.execute("UPDATE pending_review SET status=? WHERE channel_id=? AND message_id=?",
                  (STATUS_DISCARDED, channel_id, message_id))
    db.log("INFO", f"Review: discarded {row['file_name']}", channel_id=channel_id)
