# app/release_titles.py — re-derive already-indexed TV Release titles.
#
# Release titles are stored at scan time. When a TV Channel is remapped, or the
# naming changed since a Release was indexed (the TMDB year once preceded the
# episode tag), its stored titles are renamed to the series name a new Release
# would get now (Sonarr's title, else the mapped title, else the Channel title).
# Only the series part changes: the episode tag (E01E02), language and quality
# tokens are kept, so nothing is re-read from Telegram. Movie Releases are left alone.
import logging

from . import db, scanner, series_titles
from .namer import with_series_title

log = logging.getLogger("release_titles")


def _is_tv(channel) -> bool:
    return (channel["kind"] or "tv") != "movie"


def _renamed(channel_id: int, show: str) -> list[tuple[str, int, int, str]]:
    """(new title, channel id, message id, old title) for every Release whose title changes."""
    with db.conn() as c:
        rows = c.execute("SELECT message_id, title FROM releases WHERE channel_id=?", (channel_id,)).fetchall()
    renamed = ((with_series_title(r["title"], show), r["message_id"], r["title"]) for r in rows)
    return [(new, channel_id, mid, old) for new, mid, old in renamed if new != old]


async def retitle_channel(channel) -> int:
    """Rename a TV Channel's indexed Releases to its current series name; returns how
    many titles changed (0 for a movie Channel)."""
    if not _is_tv(channel):
        return 0
    show = scanner.release_show(channel, await series_titles.sonarr_title(scanner.series_tvdb_id(channel)))
    changes = _renamed(channel["id"], show)
    if changes:
        with db.conn() as c:
            # a scan may have re-indexed a Release meanwhile: only rename the title we read
            c.executemany("UPDATE releases SET title=? WHERE channel_id=? AND message_id=? AND title=?", changes)
        log.info("Retitled %d Release(s) of channel %s as %s", len(changes), channel["id"], show)
    return len(changes)


async def refresh_all() -> int:
    """Retitle every TV Channel's Releases (run at startup; a second run changes
    nothing). Returns how many titles changed."""
    with db.conn() as c:
        tv_channels = [dict(r) for r in c.execute("SELECT * FROM channels WHERE IFNULL(kind, 'tv') != 'movie'")]
    return sum([await retitle_channel(ch) for ch in tv_channels])


async def refresh_at_startup() -> None:
    """`refresh_all` as a background startup task: a failure is logged, never raised,
    so it cannot take the app down."""
    try:
        changed = await refresh_all()
    except Exception:
        log.exception("Startup refresh of TV Release titles failed")
        return
    log.info("Startup refresh of TV Release titles: %d changed", changed)
