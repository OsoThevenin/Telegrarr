# app/catalog_posters.py — poster thumbnails of a movie channel's Catalog.
#
# Resolved in their own request (GET /api/channels/{cid}/catalog/posters) so the
# Catalog itself never waits on artwork. Per film: Radarr's poster when Radarr has
# the film, else TMDB's (tmdb.movie_poster, cached per film), else None — the UI
# then shows its placeholder tile. Never contacts Telegram.
import asyncio
import logging

from . import catalog, connect, tmdb

log = logging.getLogger("catalog.posters")
MAX_PARALLEL_TMDB = 4      # concurrent TMDB lookups for one Catalog


def _radarr_poster(movie: dict) -> str | None:
    return next((i.get("remoteUrl") for i in movie.get("images") or []
                 if i.get("coverType") == "poster" and i.get("remoteUrl")), None)


async def _radarr_posters() -> dict[int, str]:
    """TMDB id → Radarr's poster URL; empty when Radarr is unset, down or failing."""
    try:
        movies = await connect.radarr_movies()
    except connect.ArrError as e:
        log.info("no Radarr posters: %s", e.key)
        return {}
    by_film = {m.get("tmdbId"): _radarr_poster(m) for m in movies if isinstance(m, dict)}
    return {tmdb_id: url for tmdb_id, url in by_film.items() if tmdb_id and url}


async def _tmdb_posters(tmdb_ids: list[int]) -> dict[int, str | None]:
    gate = asyncio.Semaphore(MAX_PARALLEL_TMDB)

    async def one(tmdb_id: int) -> str | None:
        async with gate:
            return await tmdb.movie_poster(tmdb_id)

    urls = await asyncio.gather(*(one(i) for i in tmdb_ids))
    return dict(zip(tmdb_ids, urls))


async def posters(cid: int) -> dict[int, str | None]:
    """TMDB id → poster URL (or None) for every identified film in channel `cid`'s Catalog.

    Raises catalog.CatalogError like catalog.build."""
    tmdb_ids = [r["tmdb_id"] for r in catalog.build(cid)["rows"] if r["kind"] == catalog.KIND_FILM]
    radarr = await _radarr_posters() if tmdb_ids else {}
    tmdb_found = await _tmdb_posters([i for i in tmdb_ids if i not in radarr])
    return {i: radarr.get(i) or tmdb_found.get(i) for i in tmdb_ids}
