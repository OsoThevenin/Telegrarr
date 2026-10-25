# app/routes/channel_series.py — map a series channel to its TVDB/TMDB/IMDb ids.
from fastapi import Depends, HTTPException
from pydantic import BaseModel

from .. import auth, channels, tmdb
from .common import NOT_FOUND, LooseId, keyed_router, tmdb_failed

router = keyed_router()


class SeriesMapping(BaseModel):
    tmdb_id: LooseId = None       # picked from the TMDB search
    tvdb_id: LooseId = None       # typed by the user; wins over TMDB's
    title: str | None = None


@router.put("/api/channels/{cid}/series")
async def api_map_series(cid: int, payload: SeriesMapping, user=Depends(auth.require_user)):
    """Map a series channel to its TVDB id (+ TMDB/IMDb ids derived via TMDB)."""
    if not channels.get(cid):
        raise HTTPException(NOT_FOUND)
    try:
        return await channels.map_series(cid, tmdb_id=payload.tmdb_id, tvdb_id=payload.tvdb_id,
                                         title=payload.title or "")
    except tmdb.TMDBError as e:
        raise tmdb_failed(e)
