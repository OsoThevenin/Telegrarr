# app/series_titles.py — the series name a Channel's TV Release titles start with.
#
# That is Sonarr's own series title per TVDB id, cached; without one, the mapped
# title, else the Channel title, with a trailing year dropped. TV Release titles
# carry Sonarr's title so Sonarr matches a Grab by name (its
# year match is exact, and TMDB's premiere year can differ from TVDB's). A title
# Sonarr returned is kept until the Channel is remapped. A miss (Sonarr down, not
# configured, or without the series) is remembered briefly, so one scan asks
# Sonarr once rather than once per Release, and a later scan asks again.
import logging
import re
import time

from . import connect, db

log = logging.getLogger("series_titles")

MISS_RETRY_S = 10 * 60      # how long a miss is remembered before Sonarr is asked again
_TRAILING_YEAR = re.compile(r"\s*\(\d{4}\)\s*$")     # "Títol Català (2011)" -> "Títol Català"


def is_tv(channel) -> bool:
    """Whether ``channel`` publishes series episodes (anything but a movie Channel;
    rows from before the kind column count as TV)."""
    return (channel["kind"] or "tv") != "movie"


def display_title(channel) -> str:
    """The Channel's series title as shown: the mapped title, else the Channel title."""
    return channel["imdb_title"] or channel["title"]


def series_tvdb_id(channel) -> int | None:
    """A TV Channel's mapped TVDB id (None for movies, unmapped channels, or rows
    from before the column existed)."""
    if not is_tv(channel):
        return None
    try:
        return channel["tvdb_id"]
    except (KeyError, IndexError):
        return None


def release_show(channel, sonarr_title: str | None) -> str:
    """The series name a Release title starts with: Sonarr's title, as is, else the
    display title without a trailing year (TV Release titles carry no year of their
    own). A movie Channel's display title is kept whole."""
    if sonarr_title:
        return sonarr_title
    title = display_title(channel)
    return (_TRAILING_YEAR.sub("", title) or title) if is_tv(channel) else title


def _row(tvdb_id: int):
    with db.conn() as c:
        return c.execute("SELECT title, fetched_at FROM sonarr_titles WHERE tvdb_id=?",
                         (tvdb_id,)).fetchone()


def cached(tvdb_id: int | None) -> str | None:
    """The cached Sonarr title for ``tvdb_id``, without asking Sonarr."""
    row = _row(tvdb_id) if tvdb_id else None
    return row["title"] if row else None


def _store(tvdb_id: int, title: str | None) -> None:
    with db.conn() as c:
        c.execute("INSERT INTO sonarr_titles (tvdb_id, title, fetched_at) VALUES (?, ?, ?) "
                  "ON CONFLICT(tvdb_id) DO UPDATE SET title=excluded.title, "
                  "fetched_at=excluded.fetched_at",
                  (tvdb_id, title, int(time.time())))


def forget(*tvdb_ids: int | None) -> None:
    """Drop what is cached for ``tvdb_ids`` so the next lookup asks Sonarr."""
    ids = [(i,) for i in tvdb_ids if i]
    if ids:
        with db.conn() as c:
            c.executemany("DELETE FROM sonarr_titles WHERE tvdb_id=?", ids)


async def _ask_sonarr(tvdb_id: int) -> str | None:
    try:
        return await connect.sonarr_series_title(tvdb_id)
    except connect.ArrError as e:
        log.info("Sonarr title for TVDB %s unavailable: %s", tvdb_id, e)
        return None


async def sonarr_title(tvdb_id: int | None) -> str | None:
    """Sonarr's title for the series with ``tvdb_id``: cached, else asked of Sonarr.

    None when there is no id, Sonarr is not configured or unreachable, or Sonarr
    doesn't have the series; a Sonarr outage never raises."""
    if not tvdb_id:
        return None
    row = _row(tvdb_id)
    if row and (row["title"] or time.time() - row["fetched_at"] < MISS_RETRY_S):
        return row["title"]
    title = await _ask_sonarr(tvdb_id)
    _store(tvdb_id, title)
    return title


async def series_name(channel) -> str:
    """The series name for ``channel``'s Release titles, asking Sonarr if need be."""
    return release_show(channel, await sonarr_title(series_tvdb_id(channel)))


def cached_series_name(channel) -> str:
    """`series_name` from the cache only, never asking Sonarr."""
    return release_show(channel, cached(series_tvdb_id(channel)))
