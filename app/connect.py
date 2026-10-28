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
from .http_errors import ErrorKeys, request_json
from .i18n import KeyedError

transport: httpx.AsyncBaseTransport | None = None

TIMEOUT_S = 15.0
APP_TITLES = {"prowlarr": "Prowlarr", "sonarr": "Sonarr", "radarr": "Radarr"}
API_ROOTS = {"prowlarr": "/api/v1", "sonarr": "/api/v3", "radarr": "/api/v3"}


class ArrError(KeyedError):
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
        raise ArrError("err.arr.not_set", app=APP_TITLES[app])
    return ArrApp(app, url, key)


async def _request(target: ArrApp, method: str, path: str, *, params: dict | None = None,
                   json: object = None) -> object:
    """One API call; returns the decoded JSON body or raises ArrError."""
    keys = ErrorKeys(error=ArrError, unreachable="err.arr.unreachable", bad_key="err.arr.bad_key",
                     http="err.arr.http", not_json="err.arr.not_json",
                     params={"app": target.title}, where={"url": target.url},
                     http_detail=lambda r: {"detail": _validation_detail(r)})
    async with httpx.AsyncClient(transport=transport, timeout=TIMEOUT_S) as client:
        return await request_json(client, keys, method, f"{target.url}{target.api}{path}", params=params,
                                  json=json, headers={"X-Api-Key": target.key})


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
        return {"app": app, "ok": False, "error": e.message()}
    return {"app": app, "ok": True, "version": str(status.get("version", "?"))}


# ── one-click registration ────────────────────────────────────────────
REGISTRATION_NAME = "Telegrarr"
NEWZNAB_API_PATH = "/api/newznab"
GENERIC_NEWZNAB = "Generic Newznab"
SAB_CATEGORIES = {"sonarr": ("tvCategory", "tv"), "radarr": ("movieCategory", "movies")}
DEFAULT_PORTS = {"http": 80, "https": 443}


@dataclass(frozen=True)
class Telegrarr:
    """How the *arr apps reach Telegrarr, and the key they authenticate with."""
    url: str        # e.g. http://telegrarr:8790 (no trailing slash)
    apikey: str


def _with_fields(provider: dict, values: dict) -> dict:
    """A copy of a schema ``provider`` with the named field values replaced."""
    fields = [{**f, "value": values[f["name"]]} if f.get("name") in values else dict(f)
              for f in provider.get("fields", [])]
    return {**provider, "fields": fields}


async def _existing(target: ArrApp, path: str) -> bool:
    providers = await _request(target, "GET", path)
    return any(str(p.get("name", "")).lower() == REGISTRATION_NAME.lower() for p in providers)


def _schema_entry(schema: list, implementation: str, preferred_name: str | None = None) -> dict:
    matches = [s for s in schema if s.get("implementation") == implementation]
    preferred = [s for s in matches if preferred_name in (s.get("definitionName"), s.get("name"))]
    if not matches:
        raise ArrError("err.arr.no_template", impl=implementation)
    return (preferred or matches)[0]


async def _prowlarr_indexer(target: ArrApp, me: Telegrarr) -> dict:
    schema = await _request(target, "GET", "/indexer/schema")
    profiles = await _request(target, "GET", "/appprofile")
    template = _schema_entry(schema, "Newznab", GENERIC_NEWZNAB)
    indexer = _with_fields(template, {"baseUrl": me.url, "apiPath": NEWZNAB_API_PATH, "apiKey": me.apikey})
    profile_id = profiles[0]["id"] if profiles else template.get("appProfileId", 1)
    return {**indexer, "name": REGISTRATION_NAME, "enable": True, "appProfileId": profile_id}


def _sab_location(url: str) -> dict:
    parsed = httpx.URL(url)
    return {"host": parsed.host, "port": parsed.port or DEFAULT_PORTS.get(parsed.scheme, 80),
            "useSsl": parsed.scheme == "https", "urlBase": parsed.path.rstrip("/")}


async def _sab_client(target: ArrApp, me: Telegrarr) -> dict:
    schema = await _request(target, "GET", "/downloadclient/schema")
    category_field, category = SAB_CATEGORIES[target.app]
    values = {**_sab_location(me.url), "apiKey": me.apikey, category_field: category}
    client = _with_fields(_schema_entry(schema, "Sabnzbd"), values)
    return {**client, "name": REGISTRATION_NAME, "enable": True}


async def _register_one(app: str, me: Telegrarr) -> dict:
    kind = "indexer" if app == "prowlarr" else "download_client"
    result = {"app": app, "kind": kind, "name": REGISTRATION_NAME}
    try:
        target = configured(app)
    except ArrError as e:
        return {**result, "status": "skipped", "error": e.message()}
    path = "/indexer" if app == "prowlarr" else "/downloadclient"
    try:
        if await _existing(target, path):
            return {**result, "status": "exists"}
        body = await (_prowlarr_indexer(target, me) if app == "prowlarr" else _sab_client(target, me))
        await _request(target, "POST", path, json=body)
    except ArrError as e:
        return {**result, "status": "error", "error": e.message()}
    return {**result, "status": "created"}


async def register_all(me: Telegrarr) -> list[dict]:
    """Register Telegrarr in every configured app; idempotent by name.

    Each result: {"app", "kind", "name", "status": created|exists|skipped|error, "error"?}.
    """
    return [await _register_one(app, me) for app in APP_TITLES]


# ── Sonarr episode list ───────────────────────────────────────────────
@dataclass(frozen=True)
class Episode:
    season: int
    episode: int
    title: str


async def sonarr_episodes(tvdb_id: int, season: int) -> list[Episode]:
    """Episodes of ``season`` for the Sonarr series with ``tvdb_id``, by episode number.

    Empty when Sonarr does not know the series. Raises ArrError when Sonarr is not
    configured or the request fails, so callers can fall back to another source.
    """
    target = configured("sonarr")
    series = await _request(target, "GET", "/series", params={"tvdbId": tvdb_id})
    if not series:
        return []
    rows = await _request(target, "GET", "/episode",
                          params={"seriesId": series[0]["id"], "seasonNumber": season})
    episodes = [Episode(int(e["seasonNumber"]), int(e["episodeNumber"]), str(e.get("title") or ""))
                for e in rows if int(e.get("seasonNumber", -1)) == season]
    return sorted(episodes, key=lambda e: e.episode)


# ── Radarr ────────────────────────────────────────────────────────────
@dataclass(frozen=True)
class RadarrDefaults:
    """The quality profile and root folder used when Telegrarr adds a film to Radarr."""
    quality_profile_id: int | None
    root_folder: str | None


@dataclass(frozen=True)
class RadarrChoices:
    """Radarr's quality profiles and root folders, and the effective selection among them."""
    quality_profiles: tuple[dict, ...]   # {"id", "name"}
    root_folders: tuple[dict, ...]       # {"path"}
    selected: RadarrDefaults


async def radarr_movies() -> list[dict]:
    """Radarr's whole movie list, as its ``GET /movie`` returns it; raises ArrError."""
    return await _request(configured("radarr"), "GET", "/movie")


async def radarr_quality_profiles() -> list[dict]:
    """Radarr's quality profiles as [{"id", "name"}]; raises ArrError."""
    rows = await _request(configured("radarr"), "GET", "/qualityprofile")
    return [{"id": int(p["id"]), "name": str(p.get("name") or "")} for p in rows]


async def radarr_root_folders() -> list[dict]:
    """Radarr's root folders as [{"path"}]; raises ArrError."""
    rows = await _request(configured("radarr"), "GET", "/rootfolder")
    return [{"path": str(f["path"])} for f in rows if f.get("path")]


def _pick(saved: object, available: list) -> object:
    """The saved value while Radarr still offers it, else Radarr's first (None if it offers nothing)."""
    if saved in available:
        return saved
    return available[0] if available else None


async def radarr_choices() -> RadarrChoices:
    """What the Connect page offers, read live from Radarr; raises ArrError."""
    profiles, folders = await radarr_quality_profiles(), await radarr_root_folders()
    saved_profile = settings.get_int("radarr_quality_profile_id", 0) or None
    selected = RadarrDefaults(
        quality_profile_id=_pick(saved_profile, [p["id"] for p in profiles]),
        root_folder=_pick(settings.get("radarr_root_folder", ""), [f["path"] for f in folders]))
    return RadarrChoices(tuple(profiles), tuple(folders), selected)


async def radarr_defaults() -> RadarrDefaults:
    """The effective profile id and root folder for adding a film; raises ArrError.

    The saved choice wins while Radarr still has it, otherwise Radarr's first entry.
    Raises ``err.radarr.no_defaults`` when Radarr has no profile or no root folder."""
    selected = (await radarr_choices()).selected
    if selected.quality_profile_id is None or selected.root_folder is None:
        raise ArrError("err.radarr.no_defaults")
    return selected
