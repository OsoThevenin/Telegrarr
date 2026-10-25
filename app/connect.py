# app/connect.py — clients for Prowlarr (API v1) and Sonarr/Radarr (API v3):
# connection tests, one-click registration of Telegrarr, Sonarr episode lists.
#
# Every outbound request goes through ``transport`` (None = real network), the
# seam tests replace with an ``httpx.MockTransport`` serving fake *arr apps.
# API keys travel only in the X-Api-Key header and never appear in results.
from __future__ import annotations

from dataclasses import dataclass

import httpx

from . import settings

transport: httpx.AsyncBaseTransport | None = None

TIMEOUT_S = 15.0
APP_TITLES = {"prowlarr": "Prowlarr", "sonarr": "Sonarr", "radarr": "Radarr"}
API_ROOTS = {"prowlarr": "/api/v1", "sonarr": "/api/v3", "radarr": "/api/v3"}


class ArrError(Exception):
    """A user-presentable failure talking to an *arr app (never contains the key)."""


@dataclass(frozen=True)
class ArrApp:
    """A configured *arr app: where it lives and how to authenticate."""
    app: str
    url: str
    key: str

    @property
    def title(self) -> str:
        return APP_TITLES[self.app]

    @property
    def api(self) -> str:
        return API_ROOTS[self.app]


def configured(app: str) -> ArrApp:
    """The stored settings for ``app``; raises ArrError when URL or key is missing."""
    if app not in APP_TITLES:
        raise ValueError(f"unknown app: {app}")
    url, key = settings.get(f"{app}_url", ""), settings.get(f"{app}_key", "")
    if not url or not key:
        raise ArrError(f"{APP_TITLES[app]} URL and API key are not set")
    return ArrApp(app, url, key)


async def _request(target: ArrApp, method: str, path: str, *, params: dict | None = None,
                   json: object = None) -> object:
    """One API call; returns the decoded JSON body or raises ArrError."""
    url = f"{target.url}{target.api}{path}"
    try:
        async with httpx.AsyncClient(transport=transport, timeout=TIMEOUT_S) as client:
            r = await client.request(method, url, params=params, json=json,
                                     headers={"X-Api-Key": target.key})
    except httpx.HTTPError as e:
        raise ArrError(f"Cannot reach {target.title} at {target.url}: {type(e).__name__}") from e
    if r.status_code == 401:
        raise ArrError(f"{target.title} rejected the API key")
    if r.status_code >= 400:
        raise ArrError(f"{target.title} answered HTTP {r.status_code}{_validation_detail(r)}")
    try:
        return r.json()
    except ValueError as e:
        raise ArrError(f"{target.title} at {target.url} did not answer with JSON") from e


def _validation_detail(r: httpx.Response) -> str:
    """The *arr apps answer 400 with [{propertyName, errorMessage}, ...]."""
    try:
        body = r.json()
    except ValueError:
        return ""
    if isinstance(body, list):
        msgs = [str(i.get("errorMessage")) for i in body if isinstance(i, dict) and i.get("errorMessage")]
        return f": {'; '.join(msgs)}" if msgs else ""
    if isinstance(body, dict) and body.get("message"):
        return f": {body['message']}"
    return ""


async def check_connection(app: str) -> dict:
    """{"app", "ok": True, "version"} or {"app", "ok": False, "error"}."""
    try:
        status = await _request(configured(app), "GET", "/system/status")
    except ArrError as e:
        return {"app": app, "ok": False, "error": str(e)}
    return {"app": app, "ok": True, "version": str(status.get("version", "?"))}
