# app/routes/catalog.py — movie channels: the Catalog of films a channel offers.
from fastapi import Depends

from .. import auth, catalog
from .common import BAD_REQUEST, NOT_FOUND, keyed, keyed_router

router = keyed_router()


def _refused(e: catalog.CatalogError):
    return keyed(NOT_FOUND if isinstance(e, catalog.UnknownChannel) else BAD_REQUEST, e)


@router.get("/api/channels/{cid}/catalog")
async def api_catalog(cid: int, user=Depends(auth.require_user)):
    try:
        return catalog.build(cid)
    except catalog.CatalogError as e:
        raise _refused(e)


@router.get("/api/channels/{cid}/catalog/status")
async def api_catalog_status(cid: int, user=Depends(auth.require_user)):
    """Radarr's status of each Catalog film, fetched after the list so it can show first."""
    try:
        return await catalog.radarr_status(cid)
    except catalog.CatalogError as e:
        raise _refused(e)
