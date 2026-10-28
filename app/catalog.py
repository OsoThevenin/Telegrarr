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
#
# Radarr status (served apart, so the list shows before Radarr answers):
#   {channel_id, radarr: {available, error ({key, params} | null)},
#    rows: [{tmdb_id, status, radarr_quality?, best_quality?}]}
# `status` is missing | requested | downloaded | upgrade; `radarr_quality` (the file Radarr has)
# accompanies downloaded and upgrade, `best_quality` (the channel's best) only upgrade.
from . import channels, connect, db
from .i18n import KeyedError
from .movies import STATUS_PENDING
from .namer import CHANNEL_QUALITIES, DEFAULT_LANGUAGE, LANGUAGE_TOKENS, QUALITY_SD

KIND_FILM, KIND_UNIDENTIFIED = "film", "unidentified"
STATUS_MISSING, STATUS_REQUESTED = "missing", "requested"
STATUS_DOWNLOADED, STATUS_UPGRADE = "downloaded", "upgrade"
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


# ── Radarr status ─────────────────────────────────────────────────────
# Lines per label above SD (720p → 720); a file below every one of them is SD.
_LADDER_LINES = tuple((int(label.removesuffix("p")), label) for label in RESOLUTION_LADDER if label != SD_LABEL)


def _file_resolution(movie: dict) -> str:
    """The RESOLUTION_LADDER label of the file Radarr holds for ``movie`` (unknown → SD)."""
    try:
        lines = int(movie["movieFile"]["quality"]["quality"]["resolution"])
    except (KeyError, TypeError, ValueError):
        return SD_LABEL
    return next((label for need, label in reversed(_LADDER_LINES) if lines >= need), SD_LABEL)


def film_status(best: str, movie: dict | None, requested: bool = False) -> dict:
    """One film's Radarr status, given the channel's best resolution label, Radarr's movie
    (None when Radarr doesn't have it) and whether a Download was requested locally.

    Resolution only: the movie's Radarr quality profile is deliberately ignored."""
    if movie is None or not movie.get("hasFile"):
        return {"status": STATUS_MISSING if movie is None and not requested else STATUS_REQUESTED}
    have = _file_resolution(movie)
    if resolution_rank(have) >= resolution_rank(best):
        return {"status": STATUS_DOWNLOADED, "radarr_quality": have}
    return {"status": STATUS_UPGRADE, "radarr_quality": have, "best_quality": best}


def _by_tmdb(movies: object) -> dict[int, dict]:
    """Radarr's movie list indexed by TMDB id (entries without one are skipped)."""
    if not isinstance(movies, list):
        return {}
    return {m["tmdbId"]: m for m in movies if isinstance(m, dict) and isinstance(m.get("tmdbId"), int)}


async def radarr_status(cid: int, requested: frozenset[int] = frozenset()) -> dict:
    """Radarr's view of every film in channel ``cid``'s Catalog, from one movie-list request.

    ``requested`` holds the TMDB ids of local Download requests. When Radarr is not
    configured or fails, ``radarr.available`` is false, ``error`` says why and no row has
    a status. Raises CatalogError for a missing or non-movie channel."""
    films = [row for row in build(cid)["rows"] if row["kind"] == KIND_FILM]
    try:
        movies = _by_tmdb(await connect.radarr_movies())
    except connect.ArrError as e:
        return {"channel_id": cid, "radarr": {"available": False, "error": e.message()}, "rows": []}
    rows = [{"tmdb_id": f["tmdb_id"], **film_status(f["quality"], movies.get(f["tmdb_id"]), f["tmdb_id"] in requested)}
            for f in films]
    return {"channel_id": cid, "radarr": {"available": True, "error": None}, "rows": rows}
