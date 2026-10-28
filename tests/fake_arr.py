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
    # radarr only: Radarr JSON shapes ({"id", "name"} / {"id", "path", "freeSpace"})
    quality_profiles: list[dict] = field(default_factory=list)
    root_folders: list[dict] = field(default_factory=list)
    # radarr only: Radarr's GET /movie JSON (id, tmdbId, title, year, hasFile, movieFile, images)
    movies: list[dict] = field(default_factory=list)
    reject_movie: str | None = None                             # radarr only: validation error on POST /movie
    fail_status: int | None = None      # a 5xx answered to every authenticated request (server failing)

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
        if self.fail_status is not None:
            return httpx.Response(self.fail_status, text="Internal Server Error")
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
        if path == f"{self.api}/movie" and method == "GET" and self.app == "radarr":
            tmdb = request.url.params.get("tmdbId")
            if not isinstance(self.movies, list):         # a malformed answer, served as is
                return httpx.Response(200, json=self.movies)
            return httpx.Response(200, json=[m for m in self.movies if tmdb is None or str(m["tmdbId"]) == tmdb])
        radarr = self._radarr_defaults(path, method)
        if radarr is not None:
            return radarr
        radarr = self._radarr_requests(request)
        if radarr is not None:
            return radarr
        return httpx.Response(404, json={"message": "NotFound"})

    def _radarr_defaults(self, path: str, method: str) -> httpx.Response | None:
        """Radarr's read-only lists: quality profiles and root folders (the Connect page's choices), movies."""
        if self.app != "radarr" or method != "GET":
            return None
        if path == f"{self.api}/qualityprofile":
            return httpx.Response(200, json=self.quality_profiles)
        if path == f"{self.api}/movie":
            return httpx.Response(200, json=self.movies)
        if path == f"{self.api}/rootfolder":
            return httpx.Response(200, json=self.root_folders)
        return None

    # ── radarr: Download requests (movie lookup, movie create, commands) ──
    def added_movies(self) -> list[dict]:
        """JSON bodies of every POST /movie (add a film) received."""
        return self._posted(f"{self.api}/movie")

    def commands(self) -> list[dict]:
        """JSON bodies of every POST /command received."""
        return self._posted(f"{self.api}/command")

    def _posted(self, path: str) -> list[dict]:
        return [json.loads(r.content) for r in self.requests if r.method == "POST" and r.url.path == path]

    def _radarr_requests(self, request: httpx.Request) -> httpx.Response | None:
        if self.app != "radarr":
            return None
        path, method = request.url.path, request.method
        if path == f"{self.api}/movie/lookup/tmdb" and method == "GET":
            return self._lookup(int(request.url.params.get("tmdbId", 0)))
        if path == f"{self.api}/movie" and method == "POST":
            return self._add_movie(json.loads(request.content))
        if path == f"{self.api}/command" and method == "POST":
            body = json.loads(request.content)
            return httpx.Response(201, json={**body, "id": len(self.commands()), "status": "queued"})
        return None

    def _lookup(self, tmdb_id: int) -> httpx.Response:
        """Radarr's TMDB lookup: the film's metadata, ready to be posted back to /movie."""
        if tmdb_id <= 0:
            return httpx.Response(404, json={"message": "NotFound"})
        return httpx.Response(200, json={"tmdbId": tmdb_id, "title": f"TMDB {tmdb_id}", "year": 2014,
                                         "titleSlug": f"tmdb-{tmdb_id}", "images": [], "minimumAvailability": "released"})

    def _add_movie(self, body: dict) -> httpx.Response:
        """POST /movie, refusing a TMDB id already in the library as Radarr does."""
        reason = self.reject_movie or ("This movie has already been added"
                                       if any(m["tmdbId"] == body.get("tmdbId") for m in self.movies) else None)
        if reason:
            return httpx.Response(400, json=[{"propertyName": "TmdbId", "errorMessage": reason, "severity": "error"}])
        saved = {**body, "id": len(self.movies) + 1, "hasFile": False}
        self.movies.append(saved)
        return httpx.Response(201, json=saved)

    def _create(self, body: dict) -> httpx.Response:
        if self.reject_create:
            return httpx.Response(400, json=[{"propertyName": "BaseUrl", "errorMessage": self.reject_create,
                                              "severity": "error"}])
        saved = {**body, "id": len(self.providers) + 1}
        self.providers.append(saved)
        return httpx.Response(201, json=saved)


def radarr_movie(movie_id: int, tmdb_id: int, *, resolution: int | None = None, title: str = "",
                 year: int | None = None, file_added: str | None = None, poster: str | None = None) -> dict:
    """A Radarr movie as GET /movie returns it; ``resolution`` (e.g. 1080) gives it a file,
    ``file_added`` that file's ISO ``dateAdded``, ``poster`` a poster image's remoteUrl."""
    images = [{"coverType": "poster", "url": f"/MediaCover/{movie_id}/poster.jpg", "remoteUrl": poster}] \
        if poster else []
    movie = {"id": movie_id, "tmdbId": tmdb_id, "title": title, "year": year,
             "hasFile": resolution is not None, "images": images}
    if resolution is not None:
        quality = {"quality": {"id": 0, "name": f"{resolution}p", "resolution": resolution}}
        movie["movieFile"] = {"id": movie_id, "quality": quality,
                              **({"dateAdded": file_added} if file_added else {})}
    return movie


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
