# app/routes/downloads.py — pause and resume of one transfer.
from fastapi import Depends

from .. import auth, transfers
from .common import keyed_router

router = keyed_router()


@router.post("/api/downloads/{dl_id}/pause")
async def api_pause_download(dl_id: int, user=Depends(auth.require_user)):
    return {"ok": transfers.pause_download(dl_id)}


@router.post("/api/downloads/{dl_id}/resume")
async def api_resume_download(dl_id: int, user=Depends(auth.require_user)):
    reason = await transfers.resume_download(dl_id)
    return {"ok": True} if reason is None else {"ok": False, "reason": reason}
