# app/catalog.py — a movie channel's Catalog: every film the channel offers.
#
# Built only from what Telegrarr already stores — the indexed releases and the
# channel's pending-review queue — so reading it never sends anything to Telegram.
# Releases are deduplicated by TMDB id to the best one (highest resolution, then
# the larger file); each pending-review message is its own "unidentified" row.
#
# Row JSON (later slices add fields; existing ones keep their meaning):
#   film:         {kind: "film", tmdb_id, imdb_id, title, year, quality, size, language}
#   unidentified: {kind: "unidentified", review: {channel_id, message_id}, title (raw file name),
#                  quality, size, language}
# `quality` is a resolution label on RESOLUTION_LADDER; `language` a release token (CAT, SPA, …).
from . import channels, db
from .i18n import KeyedError
from .movies import STATUS_PENDING
from .namer import CHANNEL_QUALITIES, DEFAULT_LANGUAGE, LANGUAGE_TOKENS, QUALITY_SD

KIND_FILM, KIND_UNIDENTIFIED = "film", "unidentified"
SD_LABEL = "SD"
# Lowest to highest; a quality not on it (NULL, unparsed) ranks as SD.
RESOLUTION_LADDER = tuple(SD_LABEL if q == QUALITY_SD else q for q in CHANNEL_QUALITIES)


class CatalogError(KeyedError):
    """The Catalog cannot be built for this request; the keyed message is safe to show."""


class UnknownChannel(CatalogError):
    def __init__(self, cid: int):
        super().__init__("err.catalog.unknown_channel", id=cid)


class NotMovieChannel(CatalogError):
    def __init__(self):
        super().__init__("err.catalog.not_movie_channel")


def resolution(quality: str | None) -> str:
    """A stored quality as its label on RESOLUTION_LADDER (unknown → SD)."""
    label = SD_LABEL if quality == QUALITY_SD else quality
    return label if label in RESOLUTION_LADDER else SD_LABEL


def resolution_rank(quality: str | None) -> int:
    """Position on RESOLUTION_LADDER: SD 0 < 720p < 1080p < 2160p."""
    return RESOLUTION_LADDER.index(resolution(quality))


def _title_from_release(release_title: str | None, year: int | None) -> str:
    """Display title of a release indexed before titles were stored: its dotted
    release name up to the year (The.Theory.of.Everything.2014.CAT… → The Theory of Everything)."""
    words = (release_title or "").split(".")
    if year and str(year) in words:
        words = words[:words.index(str(year))]
    return " ".join(words).strip()


def _language(channel: dict) -> str:
    return LANGUAGE_TOKENS.get(channel["language"] or DEFAULT_LANGUAGE, LANGUAGE_TOKENS[DEFAULT_LANGUAGE])


def _newest(row) -> tuple[int, int]:
    return row["added_at"] or 0, row["message_id"]


def _best_per_film(releases: list) -> dict[int, list]:
    """TMDB id → that film's releases, best first (highest resolution, then larger size)."""
    by_film: dict[int, list] = {}
    for r in releases:
        by_film.setdefault(r["movie_tmdb_id"], []).append(r)
    return {tmdb_id: sorted(rs, key=lambda r: (resolution_rank(r["quality"]), r["size"] or 0), reverse=True)
            for tmdb_id, rs in by_film.items()}


def _film_row(releases: list, language: str) -> dict:
    best = releases[0]
    return {
        "kind": KIND_FILM,
        "tmdb_id": best["movie_tmdb_id"],
        "imdb_id": best["movie_imdb_id"],
        "title": best["movie_title"] or _title_from_release(best["title"], best["year"]),
        "year": best["year"],
        "quality": resolution(best["quality"]),
        "size": best["size"] or 0,
        "language": language,
    }


def _unidentified_row(pending, language: str) -> dict:
    return {
        "kind": KIND_UNIDENTIFIED,
        "review": {"channel_id": pending["channel_id"], "message_id": pending["message_id"]},
        "title": pending["file_name"] or pending["parsed_title"] or "",
        "quality": resolution(pending["quality"]),
        "size": pending["size"] or 0,
        "language": language,
    }


def _stored(cid: int) -> tuple[list, list]:
    with db.conn() as c:
        releases = c.execute("SELECT * FROM releases WHERE channel_id=? AND movie_tmdb_id IS NOT NULL",
                             (cid,)).fetchall()
        pending = c.execute("SELECT *, created_at AS added_at FROM pending_review WHERE channel_id=? AND status=?",
                            (cid, STATUS_PENDING)).fetchall()
    return releases, pending


def build(cid: int) -> dict:
    """Channel `cid`'s Catalog, newest first. Raises CatalogError for a missing or non-movie channel."""
    channel = channels.get(cid)
    if channel is None:
        raise UnknownChannel(cid)
    if channel["kind"] != "movie":
        raise NotMovieChannel()
    language = _language(channel)
    releases, pending = _stored(cid)
    dated = [(max(map(_newest, rs)), _film_row(rs, language)) for rs in _best_per_film(releases).values()]
    dated += [(_newest(p), _unidentified_row(p, language)) for p in pending]
    rows = [row for _, row in sorted(dated, key=lambda d: d[0], reverse=True)]
    return {"channel_id": cid, "count": len(rows), "rows": rows}
