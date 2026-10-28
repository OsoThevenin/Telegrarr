# app/catalog.py — a movie channel's Catalog: every film the channel offers.
#
# Built only from what Telegrarr already stores — the indexed releases and the
# channel's pending-review queue — so reading it never sends anything to Telegram.
# Releases are deduplicated by TMDB id to the best one (highest resolution, then
# the larger file); each pending-review message is its own "unidentified" row.
#
# Row JSON (later slices add fields; existing ones keep their meaning):
#   film:         {kind: "film", tmdb_id, imdb_id, title, year, quality, size, language}
#   unidentified: {kind: "unidentified", review: {channel_id, message_id},
#                  title (raw file name), quality, size, language}
# `quality` is a resolution label on RESOLUTION_LADDER; `language` a release token (CAT, …).
#
# Radarr status (served apart, so the list shows before Radarr answers):
#   {channel_id, radarr: {available, error ({key, params} | null)}, counts,
#    rows: [{tmdb_id, status, radarr_quality?, best_quality?, poster?}]}
# `status` is missing | requested | downloaded | upgrade. `radarr_quality` (the file Radarr
# has) comes with every status where Radarr holds a file, `best_quality` (the channel's best)
# when that file is below it. `poster` is Radarr's poster URL, when it has one.
#
# A page of the Catalog (search, status filter, paging — see `page`):
#   {channel_id, count, offset, limit, next_offset, counts, rows}
# `count` is how many rows match the search and filter; `rows` the page of them from
# `offset`; `next_offset` null on the last page. `counts` covers the whole channel
# (search ignored): {all, missing, downloaded, upgrade}; the status ones are null
# unless Radarr was read (a filtered page, or the status response).
import time
from datetime import datetime

from . import channels, connect, db, tmdb
from .i18n import KeyedError, message
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


class UnknownFilter(CatalogError):
    def __init__(self, name: str):
        super().__init__("err.catalog.unknown_filter", filter=name)


class FilterNeedsRadarr(CatalogError):
    """A status filter was asked for while Radarr is not configured or not answering."""

    def __init__(self):
        super().__init__("err.catalog.filter_needs_radarr")


def resolution(quality: str | None) -> str:
    """A stored quality as its label on RESOLUTION_LADDER (unknown → SD)."""
    label = SD_LABEL if quality == QUALITY_SD else quality
    return label if label in RESOLUTION_LADDER else SD_LABEL


def resolution_rank(quality: str | None) -> int:
    """Position on RESOLUTION_LADDER: SD 0 < 720p < 1080p < 2160p."""
    return RESOLUTION_LADDER.index(resolution(quality))


def _title_from_release(release_title: str | None, year: int | None) -> str:
    """Display title of a release indexed before titles were stored: its dotted release
    name up to the year (The.Theory.of.Everything.2014.CAT… → The Theory of Everything)."""
    words = (release_title or "").split(".")
    if year and str(year) in words:
        words = words[:words.index(str(year))]
    return " ".join(words).strip()


def _language(channel: dict) -> str:
    default = LANGUAGE_TOKENS[DEFAULT_LANGUAGE]
    return LANGUAGE_TOKENS.get(channel["language"] or DEFAULT_LANGUAGE, default)


def _newest(row) -> tuple[int, int]:
    return row["added_at"] or 0, row["message_id"]


def _best_first(releases: list) -> list:
    """Highest resolution first, then the larger file."""
    return sorted(releases, key=lambda r: (resolution_rank(r["quality"]), r["size"] or 0),
                  reverse=True)


def _best_per_film(releases: list) -> dict[int, list]:
    """TMDB id → that film's releases, best first."""
    by_film: dict[int, list] = {}
    for r in releases:
        by_film.setdefault(r["movie_tmdb_id"], []).append(r)
    return {tmdb_id: _best_first(rs) for tmdb_id, rs in by_film.items()}


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
        releases = c.execute(
            "SELECT * FROM releases WHERE channel_id=? AND movie_tmdb_id IS NOT NULL",
            (cid,)).fetchall()
        pending = c.execute(
            "SELECT *, created_at AS added_at FROM pending_review WHERE channel_id=? AND status=?",
            (cid, STATUS_PENDING)).fetchall()
    return releases, pending


def build(cid: int) -> dict:
    """Channel `cid`'s Catalog, newest first.

    Raises CatalogError for a missing or non-movie channel."""
    channel = channels.get(cid)
    if channel is None:
        raise UnknownChannel(cid)
    if channel["kind"] != "movie":
        raise NotMovieChannel()
    language = _language(channel)
    releases, pending = _stored(cid)
    dated = [(max(map(_newest, rs)), _film_row(rs, language))
             for rs in _best_per_film(releases).values()]
    dated += [(_newest(p), _unidentified_row(p, language)) for p in pending]
    rows = [row for _, row in sorted(dated, key=lambda d: d[0], reverse=True)]
    return {"channel_id": cid, "count": len(rows), "rows": rows}


def film_rows(rows: list[dict]) -> list[dict]:
    """The identified films among Catalog rows."""
    return [r for r in rows if r["kind"] == KIND_FILM]


# ── Radarr status ─────────────────────────────────────────────────────
# Lines per label above SD (720p → 720); a file below every one of them is SD.
_LADDER_LINES = tuple((int(label.removesuffix("p")), label)
                      for label in RESOLUTION_LADDER if label != SD_LABEL)


def _has_file(movie: dict | None) -> bool:
    return bool(movie and movie.get("hasFile"))


def _movie_file(movie: dict) -> dict:
    """The details of the file Radarr holds for ``movie`` ({} when it gives none)."""
    found = movie.get("movieFile")
    return found if isinstance(found, dict) else {}


def _file_resolution(movie: dict) -> str:
    """The RESOLUTION_LADDER label of the file Radarr holds for ``movie`` (unknown → SD)."""
    try:
        lines = int(_movie_file(movie)["quality"]["quality"]["resolution"])
    except (KeyError, TypeError, ValueError):
        return SD_LABEL
    return next((label for need, label in reversed(_LADDER_LINES) if lines >= need), SD_LABEL)


def _file_added_after(movie: dict, requested_at: int) -> bool:
    """Whether Radarr's file arrived after the request (an unknown date counts as before)."""
    try:
        added = datetime.fromisoformat(_movie_file(movie)["dateAdded"]).timestamp()
    except (KeyError, TypeError, ValueError):
        return False
    return added > requested_at


def film_status(best: str, movie: dict | None, requested_at: int | None = None) -> dict:
    """One film's Radarr status, given the channel's best resolution label, Radarr's movie
    (None when Radarr doesn't have it) and when a Download was requested locally (None if not).

    Radarr's file wins once it reaches ``best``. A file below it reads as an upgrade, or as
    still requested (keeping both qualities) while a request newer than that file stands.
    Resolution only: the movie's Radarr quality profile is deliberately ignored."""
    if not _has_file(movie):
        asked = movie is not None or requested_at is not None
        return {"status": STATUS_REQUESTED if asked else STATUS_MISSING}
    have = _file_resolution(movie)
    if resolution_rank(have) >= resolution_rank(best):
        return {"status": STATUS_DOWNLOADED, "radarr_quality": have}
    pending = requested_at is not None and not _file_added_after(movie, requested_at)
    status = STATUS_REQUESTED if pending else STATUS_UPGRADE
    return {"status": status, "radarr_quality": have, "best_quality": best}


def _by_tmdb(movies: list[dict]) -> dict[int, dict]:
    """Radarr's movie list indexed by TMDB id (entries without one are skipped)."""
    return {m["tmdbId"]: m for m in movies if isinstance(m.get("tmdbId"), int)}


def _radarr_poster(movie: dict | None) -> str | None:
    images = (movie or {}).get("images") or []
    return next((i.get("remoteUrl") for i in images if isinstance(i, dict)
                 and i.get("coverType") == "poster" and i.get("remoteUrl")), None)


async def _radarr_view(films: list[dict]) -> tuple[dict[int, dict], dict[int, str]]:
    """TMDB id → Radarr status of each film, and → Radarr's poster URL, from one movie-list
    request. Drops the requested markers Radarr's file has answered. Raises ArrError."""
    movies = _by_tmdb(await connect.radarr_movies())
    markers = requested_markers()
    statuses = {r["tmdb_id"]: film_status(r["quality"], movies.get(r["tmdb_id"]),
                                          markers.get(r["tmdb_id"])) for r in films}
    _forget_requests([i for i in markers if i in statuses and _has_file(movies.get(i))
                      and statuses[i]["status"] != STATUS_REQUESTED])
    posters = {i: url for i in statuses if (url := _radarr_poster(movies.get(i)))}
    return statuses, posters


def _status_row(tmdb_id: int, status: dict, poster: str | None) -> dict:
    return {"tmdb_id": tmdb_id, **status, **({"poster": poster} if poster else {})}


async def radarr_status(cid: int) -> dict:
    """Radarr's view of every film in channel ``cid``'s Catalog, from one movie-list request.

    When Radarr is not configured or fails, ``radarr.available`` is false, ``error`` says
    why and no row has a status. Raises CatalogError for a missing or non-movie channel."""
    every = build(cid)["rows"]
    try:
        statuses, posters = await _radarr_view(film_rows(every))
    except connect.ArrError as e:
        return {"channel_id": cid, "radarr": {"available": False, "error": e.message()},
                "rows": [], "counts": filter_counts(every, None)}
    rows = [_status_row(i, s, posters.get(i)) for i, s in statuses.items()]
    return {"channel_id": cid, "radarr": {"available": True, "error": None}, "rows": rows,
            "counts": filter_counts(every, statuses)}


# ── search, status filters and paging ─────────────────────────────────
FILTER_ALL, FILTER_MISSING = "all", "missing"
FILTER_DOWNLOADED, FILTER_UPGRADE = "downloaded", "upgrade"
# Which statuses each filter keeps. "downloaded" is every film Radarr holds a file for:
# downloads, quality upgrades, and upgrades already requested.
FILTER_KEEPS = {
    FILTER_MISSING: lambda s: s["status"] == STATUS_MISSING,
    FILTER_DOWNLOADED: lambda s: "radarr_quality" in s,
    FILTER_UPGRADE: lambda s: s["status"] == STATUS_UPGRADE,
}
FILTERS = (FILTER_ALL, *FILTER_KEEPS)
DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE = 50, 200


def _matches(row: dict, words: list[str]) -> bool:
    """Whether every search word appears in the row's title, accents and case ignored."""
    title = tmdb.fold(row["title"])
    return all(word in title for word in words)


def filter_counts(rows: list[dict], statuses: dict[int, dict] | None) -> dict:
    """Rows per filter over ``rows``; the status filters are null when Radarr wasn't read."""
    if statuses is None:
        return {FILTER_ALL: len(rows), **{name: None for name in FILTER_KEEPS}}
    films = [statuses[r["tmdb_id"]] for r in film_rows(rows)]
    return {FILTER_ALL: len(rows),
            **{name: sum(map(keeps, films)) for name, keeps in FILTER_KEEPS.items()}}


async def page(cid: int, q: str = "", status_filter: str = FILTER_ALL, offset: int = 0,
               limit: int = DEFAULT_PAGE_SIZE) -> dict:
    """One page of channel ``cid``'s Catalog, newest first, matching ``q`` and ``status_filter``.

    Only a status filter reads Radarr (once); its rows then carry their status. Raises
    CatalogError for a missing or non-movie channel, an unknown filter, or a status filter
    while Radarr is unavailable."""
    if status_filter not in FILTERS:
        raise UnknownFilter(status_filter)
    every = build(cid)["rows"]
    rows, statuses = every, None
    if status_filter != FILTER_ALL:
        try:
            statuses, _ = await _radarr_view(film_rows(every))
        except connect.ArrError:
            raise FilterNeedsRadarr() from None
        keeps = FILTER_KEEPS[status_filter]
        rows = [{**r, **statuses[r["tmdb_id"]]} for r in film_rows(every)
                if keeps(statuses[r["tmdb_id"]])]
    words = tmdb.fold(q).split()
    rows = [r for r in rows if _matches(r, words)]
    end = offset + limit
    return {"channel_id": cid, "count": len(rows), "offset": offset, "limit": limit,
            "next_offset": end if end < len(rows) else None,
            "counts": filter_counts(every, statuses), "rows": rows[offset:end]}


# ── Download (Baixar) ─────────────────────────────────────────────────
# POST …/catalog/{tmdb_id}/download → {tmdb_id, action: "added" | "searched"}.
# Radarr is asked first; the local requested marker is saved only once it accepted.
# Each attempt is logged for the Activity page.
DOWNLOAD_EVENTS = {connect.RADARR_ADDED: "event.catalog_added",
                   connect.RADARR_SEARCHED: "event.catalog_searched"}


class NotInCatalog(CatalogError):
    def __init__(self, tmdb_id: int):
        super().__init__("err.catalog.not_in_catalog", tmdb_id=tmdb_id)


def requested_markers() -> dict[int, int]:
    """TMDB id → when a Download was requested for it (the catalog_requests markers)."""
    with db.conn() as c:
        rows = c.execute("SELECT tmdb_id, requested_at FROM catalog_requests").fetchall()
    return {row["tmdb_id"]: row["requested_at"] for row in rows}


def _mark_requested(tmdb_id: int) -> None:
    with db.conn() as c:
        c.execute("INSERT INTO catalog_requests (tmdb_id, requested_at) VALUES (?, ?) "
                  "ON CONFLICT(tmdb_id) DO UPDATE SET requested_at=excluded.requested_at",
                  (tmdb_id, int(time.time())))


def _forget_requests(tmdb_ids: list[int]) -> None:
    if not tmdb_ids:
        return
    with db.conn() as c:
        c.executemany("DELETE FROM catalog_requests WHERE tmdb_id=?", [(i,) for i in tmdb_ids])


async def download(cid: int, tmdb_id: int) -> dict:
    """Ask Radarr for a film of channel ``cid``'s Catalog and mark it requested.

    Raises CatalogError (unknown or non-movie channel, film not in the Catalog) or
    connect.ArrError (Radarr unset, unreachable or refusing); neither saves a marker."""
    film = next((r for r in film_rows(build(cid)["rows"]) if r["tmdb_id"] == tmdb_id), None)
    if film is None:
        raise NotInCatalog(tmdb_id)
    try:
        action = await connect.radarr_request(tmdb_id)
    except connect.ArrError as e:
        failed = message("event.catalog_download_failed", title=film["title"], error=str(e))
        db.log("WARN", failed, channel_id=cid)
        raise
    _mark_requested(tmdb_id)
    db.log("INFO", message(DOWNLOAD_EVENTS[action], title=film["title"]), channel_id=cid)
    return {"tmdb_id": tmdb_id, "action": action}
