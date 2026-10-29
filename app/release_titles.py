# app/release_titles.py — re-derive already-indexed TV Release titles.
#
# Release titles are stored at scan time. When a TV Channel is remapped, or the
# naming changed since a Release was indexed (the TMDB year once preceded the
# episode tag), its stored titles are renamed to the series name a new Release
# would get now (see `series_titles.series_name`). Only the series part changes:
# the episode tag (E01E02), language and quality tokens are kept, so nothing is
# re-read from Telegram. Movie Releases are left alone.
import logging
from typing import NamedTuple

from . import db, series_titles
from .i18n import message
from .namer import with_series_title

log = logging.getLogger("release_titles")


class Retitle(NamedTuple):
    """One stored Release title to rename (field order matches the UPDATE)."""
    new_title: str
    channel_id: int
    message_id: int
    old_title: str


def _renamed(channel_id: int, show: str) -> list[Retitle]:
    """Every Release of the Channel whose title changes when named after ``show``."""
    with db.conn() as c:
        rows = c.execute("SELECT message_id, title FROM releases WHERE channel_id=?",
                         (channel_id,)).fetchall()
    changes = (Retitle(with_series_title(r["title"], show), channel_id, r["message_id"], r["title"])
               for r in rows)
    return [ch for ch in changes if ch.new_title != ch.old_title]


def _apply(channel_id: int, show: str) -> int:
    changes = _renamed(channel_id, show)
    if not changes:
        return 0
    with db.conn() as c:
        # a scan may have re-indexed a Release meanwhile: only rename the title we read
        c.executemany("UPDATE releases SET title=? WHERE channel_id=? AND message_id=? AND title=?",
                      changes)
    db.log("INFO", message("event.releases_retitled", count=len(changes), show=show),
           channel_id=channel_id)
    return len(changes)


async def retitle_channel(channel) -> int:
    """Rename a remapped TV Channel's indexed Releases to its current series name,
    falling back without Sonarr (the old titles name the wrong series). Returns how
    many titles changed (0 for a movie Channel)."""
    if not series_titles.is_tv(channel):
        return 0
    return _apply(channel["id"], await series_titles.series_name(channel))


async def _refresh_channel(channel) -> int:
    """Rename a TV Channel's Releases to Sonarr's title; left as they are when Sonarr
    gives none (down, still booting, or without the series), since the fallback
    could undo a correct title."""
    title = await series_titles.sonarr_title(series_titles.series_tvdb_id(channel))
    return _apply(channel["id"], title) if title else 0


async def refresh_all() -> int:
    """Retitle every TV Channel's Releases (run at startup; a second run changes
    nothing). Returns how many titles changed."""
    with db.conn() as c:
        # same rule as series_titles.is_tv
        tv_channels = [dict(r) for r in c.execute(
            "SELECT * FROM channels WHERE IFNULL(kind, 'tv') != 'movie'")]
    return sum([await _refresh_channel(ch) for ch in tv_channels])


async def refresh_at_startup() -> None:
    """`refresh_all` as a background startup task: a failure is logged, never raised,
    so it cannot take the app down."""
    try:
        changed = await refresh_all()
    except Exception:
        log.exception("Startup refresh of TV Release titles failed")
        return
    log.info("Startup refresh of TV Release titles: %d changed", changed)
