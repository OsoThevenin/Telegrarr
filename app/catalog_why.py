# app/catalog_why.py — “Why not grabbed?”: Radarr's verdict on a Catalog film's releases.
#
# Only an operator's request runs this: nothing in Telegrarr calls it by itself. It runs
# Radarr's interactive release search, which reaches Telegrarr through Newznab, a database
# query, so it costs no Telegram reads. Answers are cached per film, so a second click
# doesn't run a second search, and a click during a search waits for that search.
#
# Answer JSON (POST …/catalog/{tmdb_id}/why-not-grabbed):
#   {tmdb_id, verdict, message: {key, params}, releases: [{title, approved, rejections}]}
# `verdict` is would_accept (a release is approved) | rejected | no_releases (Radarr's
# search found none of Telegrarr's). `rejections` are Radarr's own words, untranslated.
import asyncio
import time
from collections import defaultdict

from . import arr, catalog, connect
from .i18n import message

CACHE_TTL_S = 10 * 60
VERDICT_WOULD_ACCEPT, VERDICT_REJECTED = "would_accept", "rejected"
VERDICT_NO_RELEASES = "no_releases"
VERDICT_MESSAGES = {VERDICT_WOULD_ACCEPT: "cat.why.would_accept", VERDICT_REJECTED: "cat.why.rejected",
                    VERDICT_NO_RELEASES: "cat.why.no_releases"}

_answers: dict[int, tuple[float, dict]] = {}     # TMDB id → (monotonic expiry, answer)
_searches: defaultdict[int, asyncio.Lock] = defaultdict(asyncio.Lock)    # one search per film


class NotInRadarr(catalog.CatalogError):
    def __init__(self, tmdb_id: int):
        super().__init__("err.catalog.not_in_radarr", tmdb_id=tmdb_id)


def _is_telegrarr(release: dict) -> bool:
    """Whether Telegrarr offered ``release``. Radarr names the indexer as whoever added it did
    (Prowlarr syncs “Telegrarr (Prowlarr)”), so Telegrarr's own guid settles any other name."""
    indexer = str(release.get("indexer") or "").casefold()
    guid = str(release.get("guid") or "")
    return indexer.startswith(connect.REGISTRATION_NAME.casefold()) or guid.startswith(arr.GUID_PREFIX)


def _decision(release: dict) -> dict:
    return {"title": release.get("title"), "approved": bool(release.get("approved")),
            "rejections": release.get("rejections") or []}


def _verdict(releases: list[dict]) -> str:
    if not releases:
        return VERDICT_NO_RELEASES
    return VERDICT_WOULD_ACCEPT if any(r["approved"] for r in releases) else VERDICT_REJECTED


def _answer(tmdb_id: int, found: list[dict]) -> dict:
    releases = [_decision(r) for r in found if _is_telegrarr(r)]
    verdict = _verdict(releases)
    return {"tmdb_id": tmdb_id, "verdict": verdict, "message": message(VERDICT_MESSAGES[verdict]),
            "releases": releases}


def _cached(tmdb_id: int) -> dict | None:
    expires, answer = _answers.get(tmdb_id, (0.0, None))
    return answer if time.monotonic() < expires else None


async def why_not_grabbed(cid: int, tmdb_id: int) -> dict:
    """Radarr's decisions on Telegrarr's releases of a film of channel ``cid``'s Catalog.

    Raises catalog.CatalogError (unknown or non-movie channel, film not in the Catalog or not
    in Radarr) or connect.ArrError (Radarr unset, unreachable or failing); neither is cached."""
    if not any(r["tmdb_id"] == tmdb_id for r in catalog.film_rows(catalog.build(cid)["rows"])):
        raise catalog.NotInCatalog(tmdb_id)
    async with _searches[tmdb_id]:
        cached = _cached(tmdb_id)
        if cached is not None:
            return cached
        found = await connect.radarr_releases(tmdb_id)
        if found is None:
            raise NotInRadarr(tmdb_id)
        answer = _answer(tmdb_id, found)
        _answers[tmdb_id] = (time.monotonic() + CACHE_TTL_S, answer)
        return answer
