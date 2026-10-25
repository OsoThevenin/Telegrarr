# app/routes/directory.py — directory channel mass import.
from fastapi import Depends
from pydantic import BaseModel

from .. import auth, directory, tg
from .common import BAD_REQUEST, CONFLICT, TOO_MANY, LooseId, bad, keyed, keyed_router, normalize_chat_id

router = keyed_router()


class DirectoryScan(BaseModel):
    chat_id: LooseId = None


class ImportChannel(BaseModel):
    chat_id: LooseId = None
    title: str | None = None
    tmdb_id: LooseId = None
    tvdb_id: LooseId = None
    series_title: str | None = None


class DirectoryImport(BaseModel):
    channels: list[ImportChannel] = []


@router.post("/api/directory/scan")
async def api_directory_scan(payload: DirectoryScan, user=Depends(auth.require_user)):
    chat_id = normalize_chat_id(payload.chat_id)
    client = await tg.authorized_client()
    if not client:
        raise bad(CONFLICT, "err.tg.not_connected")
    try:
        return await directory.scan(client, chat_id)
    except directory.ScanRefused as e:
        raise keyed(TOO_MANY, e)


def _import_item(raw: ImportChannel) -> directory.ImportItem:
    return directory.ImportItem(chat_id=normalize_chat_id(raw.chat_id), title=raw.title or "",
                                tmdb_id=raw.tmdb_id, tvdb_id=raw.tvdb_id,
                                series_title=raw.series_title or "")


@router.post("/api/directory/import")
async def api_directory_import(payload: DirectoryImport, user=Depends(auth.require_user)):
    if not payload.channels:
        raise bad(BAD_REQUEST, "err.directory.import_empty")
    if len(payload.channels) > directory.MAX_IMPORT_ITEMS:
        raise bad(BAD_REQUEST, "err.directory.import_too_many", max=directory.MAX_IMPORT_ITEMS)
    return {"results": await directory.import_channels([_import_item(r) for r in payload.channels])}
