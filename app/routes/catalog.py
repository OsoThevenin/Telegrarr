# app/routes/catalog.py — movie channels: the Catalog of films a channel offers.
from fastapi import Depends, Query

from .. import auth, catalog, catalog_posters, connect
from .common import BAD_GATEWAY, BAD_REQUEST, NOT_FOUND, keyed, keyed_router

router = keyed_router()


def _refused(e: catalog.CatalogError):
    if isinstance(e, catalog.UnknownChannel | catalog.NotInCatalog):
        return keyed(NOT_FOUND, e)
    return keyed(BAD_GATEWAY if isinstance(e, catalog.FilterNeedsRadarr) else BAD_REQUEST, e)


@router.get("/api/channels/{cid}/catalog")
async def api_catalog(cid: int, q: str = "", filter: str = catalog.FILTER_ALL,
                      offset: int = Query(0, ge=0),
                      limit: int = Query(catalog.DEFAULT_PAGE_SIZE, ge=1, le=catalog.MAX_PAGE_SIZE),
                      user=Depends(auth.require_user)):
    """A page of the Catalog: search ``q``, status ``filter`` (only that reads Radarr), ``offset``/``limit``."""
    try:
        return await catalog.page(cid, q=q, status_filter=filter, offset=offset, limit=limit)
    except catalog.CatalogError as e:
        raise _refused(e)


@router.get("/api/channels/{cid}/catalog/status")
async def api_catalog_status(cid: int, user=Depends(auth.require_user)):
    """Radarr's status of each Catalog film, fetched after the list so it can show first."""
    try:
        return await catalog.radarr_status(cid, requested=catalog.requested_tmdb_ids())
    except catalog.CatalogError as e:
        raise _refused(e)


@router.post("/api/channels/{cid}/catalog/{tmdb_id}/download")
async def api_catalog_download(cid: int, tmdb_id: int, user=Depends(auth.require_user)):
    """Download (Baixar): ask Radarr for the film → {tmdb_id, action: added | searched}."""
    try:
        return await catalog.download(cid, tmdb_id)
    except catalog.CatalogError as e:
        raise _refused(e)
    except connect.ArrError as e:
        raise keyed(BAD_GATEWAY, e)


@router.get("/api/channels/{cid}/catalog/posters")
async def api_catalog_posters(cid: int, user=Depends(auth.require_user)):
    """{posters: {tmdb_id: poster URL | null}}, fetched apart so the Catalog never waits on art."""
    try:
        return {"posters": await catalog_posters.posters(cid)}
    except catalog.CatalogError as e:
        raise _refused(e)
