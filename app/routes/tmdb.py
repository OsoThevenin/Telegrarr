# app/routes/tmdb.py — TMDB search and the TMDB key test.
from fastapi import Depends
from pydantic import BaseModel

from .. import auth, tmdb
from .common import keyed_router, tmdb_failed

router = keyed_router()


class KeyTest(BaseModel):
    key: str | None = None        # a key to try before saving it; else the stored one


@router.get("/api/tmdb/search")
async def api_tmdb_search(q: str = "", user=Depends(auth.require_user)):
    try:
        return await tmdb.search_series(q)
    except tmdb.TMDBError as e:
        raise tmdb_failed(e)


@router.get("/api/tmdb/movies")
async def api_tmdb_movies(q: str = "", year: int | None = None, user=Depends(auth.require_user)):
    try:
        return await tmdb.search_movies(q, year)
    except tmdb.TMDBError as e:
        raise tmdb_failed(e)


@router.post("/api/integrations/tmdb/test")
async def api_tmdb_test(payload: KeyTest | None = None, user=Depends(auth.require_user)):
    return await tmdb.test((payload.key if payload else None) or None)
