"""Fake Prowlarr / Sonarr / Radarr servers for tests, served through
``httpx.MockTransport`` so no socket is opened.

Each fake keeps just enough state to behave like the real API for the calls
Telegrarr makes (system status, provider schema, list + create providers,
series + episode lookup), checks the ``X-Api-Key`` header and records every
request so tests can verify payloads.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

import httpx

# Trimmed-down provider schemas, shaped like the real /schema responses.
PROWLARR_INDEXER_SCHEMA = [
    {"name": "NZBgeek", "definitionName": "NZBgeek", "implementation": "Newznab",
     "configContract": "NewznabSettings", "protocol": "usenet", "enable": True,
     "appProfileId": 0, "priority": 25, "tags": [],
     "fields": [{"name": "baseUrl", "value": "https://api.nzbgeek.info"},
                {"name": "apiPath", "value": "/api"}, {"name": "apiKey"}]},
    {"name": "Generic Newznab", "definitionName": "Generic Newznab", "implementation": "Newznab",
     "configContract": "NewznabSettings", "protocol": "usenet", "enable": True,
     "appProfileId": 0, "priority": 25, "tags": [],
     "fields": [{"name": "baseUrl", "value": ""}, {"name": "apiPath", "value": "/api"},
                {"name": "apiKey"}, {"name": "additionalParameters"},
                {"name": "vipExpiration", "value": ""}]},
    {"name": "Generic Torznab", "definitionName": "Generic Torznab", "implementation": "Torznab",
     "configContract": "TorznabSettings", "protocol": "torrent", "fields": []},
]


def _sab_schema(category_field: str) -> list[dict]:
    return [
        {"name": "", "implementation": "QBittorrent", "configContract": "QBittorrentSettings",
         "protocol": "torrent", "fields": [{"name": "host", "value": "localhost"}]},
        {"name": "", "implementation": "Sabnzbd", "implementationName": "SABnzbd",
         "configContract": "SabnzbdSettings", "protocol": "usenet", "enable": True,
         "priority": 1, "removeCompletedDownloads": True, "removeFailedDownloads": True, "tags": [],
         "fields": [{"name": "host", "value": "localhost"}, {"name": "port", "value": 8080},
                    {"name": "useSsl", "value": False}, {"name": "urlBase"}, {"name": "apiKey"},
                    {"name": "username"}, {"name": "password"},
                    {"name": category_field, "value": category_field.removesuffix("Category")}]},
    ]


@dataclass
class FakeArr:
    """One fake *arr instance."""
    app: str            # "prowlarr" | "sonarr" | "radarr"
    api_key: str
    version: str
    api: str            # "/api/v1" | "/api/v3"
    providers: list[dict] = field(default_factory=list)       # indexers or download clients
    requests: list[httpx.Request] = field(default_factory=list)
    series: list[dict] = field(default_factory=list)           # sonarr only
    episodes: list[dict] = field(default_factory=list)         # sonarr only
    reject_create: str | None = None                            # validation error on POST

    @property
    def provider_path(self) -> str:
        return f"{self.api}/indexer" if self.app == "prowlarr" else f"{self.api}/downloadclient"

    def created(self) -> list[dict]:
        """JSON bodies of every provider-create POST received."""
        return [json.loads(r.content) for r in self.requests
                if r.method == "POST" and r.url.path == self.provider_path]

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if request.headers.get("X-Api-Key") != self.api_key:
            return httpx.Response(401, json={"error": "Unauthorized"})
        path, method = request.url.path, request.method
        if path == f"{self.api}/system/status":
            return httpx.Response(200, json={"appName": self.app.title(), "version": self.version})
        if path == f"{self.provider_path}/schema":
            schema = (PROWLARR_INDEXER_SCHEMA if self.app == "prowlarr"
                      else _sab_schema("tvCategory" if self.app == "sonarr" else "movieCategory"))
            return httpx.Response(200, json=schema)
        if path == f"{self.api}/appprofile" and self.app == "prowlarr":
            return httpx.Response(200, json=[{"id": 1, "name": "Standard"}])
        if path == self.provider_path and method == "GET":
            return httpx.Response(200, json=self.providers)
        if path == self.provider_path and method == "POST":
            return self._create(json.loads(request.content))
        if path == f"{self.api}/series" and self.app == "sonarr":
            tvdb = request.url.params.get("tvdbId")
            return httpx.Response(200, json=[s for s in self.series if str(s["tvdbId"]) == tvdb])
        if path == f"{self.api}/episode" and self.app == "sonarr":
            sid, season = request.url.params.get("seriesId"), request.url.params.get("seasonNumber")
            return httpx.Response(200, json=[e for e in self.episodes if str(e["seriesId"]) == sid
                                             and (season is None or str(e["seasonNumber"]) == season)])
        return httpx.Response(404, json={"message": "NotFound"})

    def _create(self, body: dict) -> httpx.Response:
        if self.reject_create:
            return httpx.Response(400, json=[{"propertyName": "BaseUrl", "errorMessage": self.reject_create,
                                              "severity": "error"}])
        saved = {**body, "id": len(self.providers) + 1}
        self.providers.append(saved)
        return httpx.Response(201, json=saved)


PROWLARR_KEY = "prowlarr-secret-key"
SONARR_KEY = "sonarr-secret-key"
RADARR_KEY = "radarr-secret-key"


@dataclass
class FakeArrStack:
    """Prowlarr, Sonarr and Radarr reachable by host name through one transport."""
    prowlarr: FakeArr
    sonarr: FakeArr
    radarr: FakeArr
    hosts: dict[str, FakeArr]

    def transport(self) -> httpx.MockTransport:
        def route(request: httpx.Request) -> httpx.Response:
            target = self.hosts.get(request.url.host)
            if target is None:
                raise httpx.ConnectError(f"Name or service not known: {request.url.host}", request=request)
            return target.handle(request)
        return httpx.MockTransport(route)

    def find_field(self, provider: dict, name: str) -> Any:
        return next(f.get("value") for f in provider["fields"] if f["name"] == name)


def make_stack(prowlarr_key: str, sonarr_key: str, radarr_key: str) -> FakeArrStack:
    prowlarr = FakeArr("prowlarr", prowlarr_key, "1.37.0.5076", "/api/v1")
    sonarr = FakeArr("sonarr", sonarr_key, "4.0.19.2979", "/api/v3")
    radarr = FakeArr("radarr", radarr_key, "6.3.0.10170", "/api/v3")
    return FakeArrStack(prowlarr, sonarr, radarr,
                        hosts={"prowlarr.test": prowlarr, "sonarr.test": sonarr, "radarr.test": radarr})
