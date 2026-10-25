"""A fake TMDB v3 API served through ``httpx.MockTransport``.

Install it with the ``fake_tmdb`` fixture (tests/conftest.py), which points the
app's TMDB HTTP seam (``app.tmdb.transport``) at this fake. Only the HTTP
transport is substituted: the app builds real requests and parses real JSON.

Search honours the ``language`` param the way TMDB does for the cases we care
about: a series is only found by a title it has *in that language*, so a show
with no Catalan title is missed by a ``ca-ES`` search and found by ``en-US``.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import httpx

API_KEY = "fake-tmdb-key"
API_PREFIX = "/3"


@dataclass(frozen=True)
class FakeSeries:
    tmdb_id: int
    titles: dict[str, str]          # language ("ca-ES", "en-US") -> title
    first_air_date: str = ""
    tvdb_id: int | None = None
    imdb_id: str | None = None
    poster_path: str | None = None

    def title_in(self, language: str) -> str:
        return self.titles.get(language) or self.titles.get("en-US") or next(iter(self.titles.values()))


@dataclass
class FakeTMDB:
    series: dict[int, FakeSeries] = field(default_factory=dict)
    requests: list[httpx.Request] = field(default_factory=list)

    def add_series(self, tmdb_id: int, *, titles: dict[str, str], first_air_date: str = "",
                   tvdb_id: int | None = None, imdb_id: str | None = None) -> FakeSeries:
        show = FakeSeries(tmdb_id=tmdb_id, titles=titles, first_air_date=first_air_date,
                          tvdb_id=tvdb_id, imdb_id=imdb_id, poster_path=f"/poster{tmdb_id}.jpg")
        self.series[tmdb_id] = show
        return show

    def searches(self) -> list[tuple[str, str]]:
        """(query, language) of every /search/tv call received, in order."""
        return [(r.url.params.get("query", ""), r.url.params.get("language", ""))
                for r in self.requests if r.url.path == f"{API_PREFIX}/search/tv"]

    @property
    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self._handle)

    # ── request routing ─────────────────────────────────────────────
    def _handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if request.url.params.get("api_key") != API_KEY:
            return httpx.Response(401, json={"status_code": 7, "status_message": "Invalid API key"})
        path = request.url.path.removeprefix(API_PREFIX)
        parts = path.strip("/").split("/")
        if parts == ["configuration"]:
            return httpx.Response(200, json={"images": {}})
        if parts == ["search", "tv"]:
            return self._search_tv(request.url.params)
        if len(parts) == 3 and parts[0] == "tv" and parts[2] == "external_ids":
            return self._external_ids(int(parts[1]))
        if len(parts) == 2 and parts[0] == "find":
            return self._find(parts[1], request.url.params.get("external_source", ""))
        return httpx.Response(404, json={"status_code": 34, "status_message": "Not found"})

    def _search_tv(self, params) -> httpx.Response:
        query = params.get("query", "").lower()
        language = params.get("language", "en-US")
        hits = [s for s in self.series.values() if query and query in s.titles.get(language, "").lower()]
        results = [{"id": s.tmdb_id, "name": s.title_in(language), "original_name": s.title_in("en-US"),
                    "first_air_date": s.first_air_date, "poster_path": s.poster_path} for s in hits]
        return httpx.Response(200, json={"page": 1, "results": results, "total_results": len(results)})

    def _external_ids(self, tmdb_id: int) -> httpx.Response:
        show = self.series.get(tmdb_id)
        if not show:
            return httpx.Response(404, json={"status_code": 34})
        return httpx.Response(200, json={"id": tmdb_id, "tvdb_id": show.tvdb_id, "imdb_id": show.imdb_id})

    def _find(self, external_id: str, source: str) -> httpx.Response:
        def matches(s: FakeSeries) -> bool:
            if source == "tvdb_id":
                return str(s.tvdb_id) == external_id
            if source == "imdb_id":
                return s.imdb_id == external_id
            return False
        tv = [{"id": s.tmdb_id, "name": s.title_in("en-US"), "first_air_date": s.first_air_date}
              for s in self.series.values() if matches(s)]
        return httpx.Response(200, json={"tv_results": tv, "movie_results": []})
