# app/routes/review.py — movie channels: the Pending review queue.
from fastapi import Depends
from pydantic import BaseModel

from .. import auth, movies
from .common import BAD_REQUEST, NOT_FOUND, LooseId, keyed, keyed_router

router = keyed_router()


class FilmChoice(BaseModel):
    tmdb_id: LooseId = None
    imdb_id: str | None = None


@router.get("/api/review")
async def api_review(user=Depends(auth.require_user)):
    return movies.pending()


@router.post("/api/review/{cid}/{mid}/assign")
async def api_review_assign(cid: int, mid: int, payload: FilmChoice, user=Depends(auth.require_user)):
    try:
        return await movies.assign(cid, mid, payload.tmdb_id, payload.imdb_id)
    except movies.NotPending as e:
        raise keyed(NOT_FOUND, e)
    except movies.ReviewError as e:
        raise keyed(BAD_REQUEST, e)


@router.post("/api/review/{cid}/{mid}/discard")
async def api_review_discard(cid: int, mid: int, user=Depends(auth.require_user)):
    try:
        movies.discard(cid, mid)
    except movies.NotPending as e:
        raise keyed(NOT_FOUND, e)
    return {"ok": True}
