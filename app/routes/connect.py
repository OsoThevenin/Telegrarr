# app/routes/connect.py — Connect page: Prowlarr / Sonarr / Radarr.
from fastapi import Depends
from pydantic import BaseModel, Field

from .. import arr, auth, connect, db, i18n, settings
from .common import BAD_GATEWAY, BAD_REQUEST, bad, keyed, keyed_router

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


# ── default Radarr quality profile + root folder ──────────────────────
def _choices_view(choices: connect.RadarrChoices) -> dict:
    return {"quality_profiles": list(choices.quality_profiles), "root_folders": list(choices.root_folders),
            "selected": {"quality_profile_id": choices.selected.quality_profile_id,
                         "root_folder": choices.selected.root_folder}}


@router.get("/api/connect/radarr/defaults")
async def api_radarr_defaults(user=Depends(auth.require_user)):
    try:
        return _choices_view(await connect.radarr_choices())
    except connect.ArrError as e:
        raise keyed(BAD_GATEWAY, e)


class RadarrDefaultsChoice(BaseModel):
    quality_profile_id: int = Field(0, ge=0)   # 0 = Radarr's first
    root_folder: str = ""                       # "" = Radarr's first


@router.put("/api/connect/radarr/defaults")
async def api_radarr_defaults_save(payload: RadarrDefaultsChoice, user=Depends(auth.require_user)):
    saved = settings.apply({"radarr_quality_profile_id": payload.quality_profile_id,
                            "radarr_root_folder": payload.root_folder})
    return {"quality_profile_id": saved["radarr_quality_profile_id"], "root_folder": saved["radarr_root_folder"]}
