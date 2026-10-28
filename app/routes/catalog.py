# app/routes/catalog.py — movie channels: the Catalog of films a channel offers.
from fastapi import Depends

from .. import auth, catalog
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
