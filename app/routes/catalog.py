# app/routes/catalog.py — movie channels: the Catalog of films a channel offers.
from fastapi import Depends

from .. import auth, catalog, catalog_posters
from .common import BAD_REQUEST, NOT_FOUND, keyed, keyed_router

router = keyed_router()


@router.get("/api/channels/{cid}/catalog")
async def api_catalog(cid: int, user=Depends(auth.require_user)):
    try:
        return catalog.build(cid)
    except catalog.UnknownChannel as e:
        raise keyed(NOT_FOUND, e)
    except catalog.NotMovieChannel as e:
        raise keyed(BAD_REQUEST, e)


@router.get("/api/channels/{cid}/catalog/posters")
async def api_catalog_posters(cid: int, user=Depends(auth.require_user)):
    """{posters: {tmdb_id: poster URL | null}}, fetched apart so the Catalog never waits on art."""
    try:
        return {"posters": await catalog_posters.posters(cid)}
    except catalog.UnknownChannel as e:
        raise keyed(NOT_FOUND, e)
    except catalog.NotMovieChannel as e:
        raise keyed(BAD_REQUEST, e)
