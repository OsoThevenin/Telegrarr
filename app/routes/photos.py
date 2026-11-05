# app/routes/photos.py — a channel's cached Telegram profile photo.
from fastapi import Depends, HTTPException, Response

from .. import auth, channel_photos, channels
from .common import NOT_FOUND, bad, keyed_router

router = keyed_router()
PHOTO_MEDIA_TYPE = "image/jpeg"


@router.get("/api/channels/{cid}/photo")
async def api_channel_photo(cid: int, user=Depends(auth.require_user)) -> Response:
    """The channel's image, or 404 `err.photo.none` when there is no photo to show
    (a plain 404 means the channel doesn't exist)."""
    channel = channels.get(cid)
    if not channel:
        raise HTTPException(NOT_FOUND)
    photo = await channel_photos.photo_of(channel)
    if photo is None:
        raise bad(NOT_FOUND, "err.photo.none")
    return Response(photo, media_type=PHOTO_MEDIA_TYPE)
