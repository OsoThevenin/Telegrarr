# app/routes/catalog.py — movie channels: the Catalog of films a channel offers.
import functools

from fastapi import Depends, Query

from .. import auth, catalog, catalog_posters, connect
from .common import BAD_GATEWAY, BAD_REQUEST, NOT_FOUND, keyed, keyed_router

router = keyed_router()


def _refused(e: catalog.CatalogError):
    if isinstance(e, catalog.UnknownChannel | catalog.NotInCatalog):
        return keyed(NOT_FOUND, e)
    return keyed(BAD_GATEWAY if isinstance(e, catalog.FilterNeedsRadarr) else BAD_REQUEST, e)


def _keyed_errors(endpoint):
    """Turn a CatalogError or a Radarr ArrError raised by ``endpoint`` into a keyed HTTP error."""
    @functools.wraps(endpoint)
    async def guarded(*args, **kwargs):
        try:
            return await endpoint(*args, **kwargs)
        except catalog.CatalogError as e:
            raise _refused(e) from None
        except connect.ArrError as e:
            raise keyed(BAD_GATEWAY, e) from None
    return guarded


@router.get("/api/channels/{cid}/catalog")
@_keyed_errors
async def api_catalog(cid: int, q: str = "", filter: str = catalog.FILTER_ALL,
                      offset: int = Query(0, ge=0),
                      limit: int = Query(catalog.DEFAULT_PAGE_SIZE, ge=1,
                                         le=catalog.MAX_PAGE_SIZE),
                      user=Depends(auth.require_user)):
    """A page of the Catalog: search ``q``, status ``filter`` (only that reads Radarr),
    ``offset``/``limit``."""
    return await catalog.page(cid, q=q, status_filter=filter, offset=offset, limit=limit)


@router.get("/api/channels/{cid}/catalog/status")
@_keyed_errors
async def api_catalog_status(cid: int, user=Depends(auth.require_user)):
    """Radarr's status (and poster) of each Catalog film, fetched after the list."""
    return await catalog.radarr_status(cid)


@router.post("/api/channels/{cid}/catalog/{tmdb_id}/download")
@_keyed_errors
async def api_catalog_download(cid: int, tmdb_id: int, user=Depends(auth.require_user)):
    """Download (Baixar): ask Radarr for the film → {tmdb_id, action: added | searched}."""
    return await catalog.download(cid, tmdb_id)


@router.get("/api/channels/{cid}/catalog/posters")
@_keyed_errors
async def api_catalog_posters(cid: int, ids: list[int] | None = Query(None),
                              user=Depends(auth.require_user)):
    """{posters: {tmdb_id: TMDB poster URL | null}} for films ``ids`` (default: every film),
    fetched apart so the Catalog never waits on art."""
    return {"posters": await catalog_posters.posters(cid, ids)}
