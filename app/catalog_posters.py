# app/catalog_posters.py — TMDB poster thumbnails of a movie channel's Catalog.
#
# Resolved in their own request (GET /api/channels/{cid}/catalog/posters) so the
# Catalog itself never waits on artwork. Radarr's own posters come with the status
# response (one Radarr movie-list read per drawer opening), so this asks only TMDB
# (tmdb.movie_poster, cached per film), for the films the UI still lacks one for.
# A film without a poster maps to None: the UI keeps its placeholder tile.
# Never contacts Telegram or Radarr.
import asyncio

from . import catalog, tmdb

MAX_PARALLEL_TMDB = 4      # concurrent TMDB lookups for one Catalog


async def _tmdb_posters(tmdb_ids: list[int]) -> dict[int, str | None]:
    gate = asyncio.Semaphore(MAX_PARALLEL_TMDB)

    async def one(tmdb_id: int) -> str | None:
        async with gate:
            return await tmdb.movie_poster(tmdb_id)

    urls = await asyncio.gather(*(one(i) for i in tmdb_ids))
    return dict(zip(tmdb_ids, urls))


async def posters(cid: int, wanted: list[int] | None = None) -> dict[int, str | None]:
    """TMDB id → TMDB poster URL (or None) for the films of channel `cid`'s Catalog in
    ``wanted`` (every film when None; ids the Catalog doesn't offer are ignored).

    Raises catalog.CatalogError like catalog.build."""
    offered = [r["tmdb_id"] for r in catalog.film_rows(catalog.build(cid)["rows"])]
    asked = offered if wanted is None else [i for i in offered if i in set(wanted)]
    return await _tmdb_posters(asked)
