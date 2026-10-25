# app/routes/connect.py — Connect page: Prowlarr / Sonarr / Radarr.
from fastapi import Depends
from pydantic import BaseModel

from .. import arr, auth, connect, db, i18n, settings
from .common import BAD_REQUEST, bad, keyed_router

router = keyed_router()


class ConnectionTest(BaseModel):
    app: str = ""


def _arr_app_name(payload: ConnectionTest) -> str:
    if payload.app not in connect.APP_TITLES:
        raise bad(BAD_REQUEST, "err.connect.unknown_app")
    return payload.app


@router.post("/api/connect/test")
async def api_connect_test(payload: ConnectionTest, user=Depends(auth.require_user)):
    return await connect.check_connection(_arr_app_name(payload))


def _log_registration(res: dict) -> None:
    params = {"kind": i18n.message(f"connect.kind.{res['kind']}"), "app": connect.APP_TITLES[res["app"]]}
    if res["status"] == "created":
        db.log("INFO", i18n.message("event.connect_registered", **params))
    elif res["status"] == "error":
        db.log("WARN", i18n.message("event.connect_failed", **params, error=res["error"]))


@router.post("/api/connect/register")
async def api_connect_register(user=Depends(auth.require_user)):
    me_url = settings.get("telegrarr_url", "")
    if not me_url:
        raise bad(BAD_REQUEST, "err.connect.own_url_missing")
    results = await connect.register_all(connect.Telegrarr(url=me_url, apikey=arr.apikey()))
    for res in results:
        _log_registration(res)
    return {"results": results}
