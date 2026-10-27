# app/plex.py — targeted Plex library refresh so new episodes appear in seconds.
import logging
import httpx
from . import settings
from .i18n import message

log = logging.getLogger("plex")


def _creds():
    return settings.get("plex_url", "").rstrip("/"), settings.get("plex_token", "")


def _scrub(msg, token):
    return str(msg).replace(token, "***") if token else str(msg)


async def _sections(client, url, token):
    # token in header, never the query string (query strings leak into logs/errors)
    r = await client.get(f"{url}/library/sections",
                         headers={"X-Plex-Token": token, "Accept": "application/json"},
                         timeout=10)
    r.raise_for_status()
    return r.json().get("MediaContainer", {}).get("Directory", []) or []


async def refresh_path(folder: str):
    url, token = _creds()
    if not (url and token):
        return
    try:
        async with httpx.AsyncClient() as client:
            best = None
            for sec in await _sections(client, url, token):
                for loc in sec.get("Location", []) or []:
                    p = loc.get("path", "")
                    if p and folder.startswith(p) and (best is None or len(p) > best[1]):
                        best = (sec.get("key"), len(p))
            if not best:
                log.info("no Plex section matches %s", folder)
                return
            await client.get(f"{url}/library/sections/{best[0]}/refresh",
                             params={"path": folder}, headers={"X-Plex-Token": token},
                             timeout=10)
            log.info("Plex refresh queued for section %s", best[0])
    except Exception as e:
        log.warning("Plex refresh failed: %s", _scrub(e, token))


async def test() -> dict:
    """Verify Plex creds; returns {ok, detail, sections}."""
    url, token = _creds()
    if not (url and token):
        return {"ok": False, "detail": message("plex.test.not_set")}
    try:
        async with httpx.AsyncClient() as client:
            secs = await _sections(client, url, token)
        return {"ok": True, "detail": message("plex.test.ok", n=len(secs)),
                "sections": [s.get("title") for s in secs]}
    except Exception as e:
        return {"ok": False, "detail": message("plex.test.failed", error=_scrub(e, token))}
