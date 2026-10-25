# app/tmdb.py — poster/backdrop artwork.
# Works KEYLESS out of the box via IMDb's public suggestion API (posters);
# if a TMDB key is configured it's preferred (higher-res posters + backdrops).
# All lookups are server-side; the browser only receives public image URLs.
import re
import time
import logging
import unicodedata
import urllib.parse
from dataclasses import dataclass
from difflib import SequenceMatcher

import httpx
from . import settings

log = logging.getLogger("art")
API = "https://api.themoviedb.org/3"
IMG = "https://image.tmdb.org/t/p/"
TIMEOUT_S = 10
SEARCH_LANGUAGES = ("ca-ES", "en-US")   # Catalan titles first, English as fallback
KEY_REQUIRED = "A TMDB API key is required to map channels. Add it in Settings → Integrations → Artwork (TMDB)."

# HTTP seam: every outbound request of this module goes through http(). Tests set
# `transport` to an httpx.MockTransport to fake TMDB at the wire level.
transport: httpx.AsyncBaseTransport | None = None


def http() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=transport, timeout=TIMEOUT_S)
_cache = {}          # imdb_id -> (ts, data)
TTL = 86400          # 1 day


async def _tmdb_art(imdb_id, key):
    try:
        async with http() as client:
            r = await client.get(f"{API}/find/{imdb_id}",
                                  params={"api_key": key, "external_source": "imdb_id"})
            r.raise_for_status()
            j = r.json()
        results = (j.get("tv_results") or []) + (j.get("movie_results") or [])
        if not results:
            return {}
        m = results[0]
        return {
            "poster": (IMG + "w342" + m["poster_path"]) if m.get("poster_path") else "",
            "backdrop": (IMG + "w1280" + m["backdrop_path"]) if m.get("backdrop_path") else "",
            "title": m.get("name") or m.get("title") or "",
            "rating": round(m.get("vote_average") or 0, 1),
            "year": (m.get("first_air_date") or m.get("release_date") or "")[:4],
        }
    except Exception as e:
        log.warning("tmdb art failed for %s: %s", imdb_id, e)
        return {}


def _imdb_resize(url):
    # IMDb/Amazon image URLs accept a size transform before the extension.
    return re.sub(r"\._V1_.*?(\.\w+)$", r"._V1_QL75_UX342_\1", url) if "._V1_" in url else url


async def _imdb_art(imdb_id, title):
    q = (title or imdb_id).strip()
    if not q:
        return {}
    first = q.lower()[0]
    url = f"https://v3.sg.media-imdb.com/suggestion/{first}/{urllib.parse.quote(q)}.json"
    try:
        async with http() as client:
            r = await client.get(url, headers={"User-Agent": "Mozilla/5.0"})
            r.raise_for_status()
            items = r.json().get("d", []) or []
    except Exception as e:
        log.warning("imdb art failed for %s: %s", imdb_id, e)
        return {}
    # prefer the exact id match; else first result that has an image
    pick = next((it for it in items if it.get("id") == imdb_id and it.get("i", {}).get("imageUrl")), None) \
        or next((it for it in items if it.get("i", {}).get("imageUrl")), None)
    if not pick:
        return {}
    return {"poster": _imdb_resize(pick["i"]["imageUrl"]), "backdrop": "",
            "title": pick.get("l", ""), "year": str(pick.get("y") or ""), "rating": 0}


async def art(imdb_id, title=""):
    if not imdb_id:
        return {}
    now = time.time()
    hit = _cache.get(imdb_id)
    if hit and now - hit[0] < TTL:
        return hit[1]
    key = settings.get("tmdb_key", "")
    data = await _tmdb_art(imdb_id, key) if key else {}
    if not data.get("poster"):                       # keyless fallback (or TMDB miss)
        imdb = await _imdb_art(imdb_id, title)
        if imdb.get("poster"):
            imdb["backdrop"] = data.get("backdrop", "")
            data = imdb
    _cache[imdb_id] = (now, data)
    return data


async def test(key=None):
    # tests the passed-in key if given (so users can verify before saving), else the stored one
    k = (key or settings.get("tmdb_key", "")).strip()
    if not k:
        return {"ok": False, "detail": "No key entered — a TMDB key is required to map channels to their ids."}
    try:
        async with http() as client:
            r = await client.get(f"{API}/configuration", params={"api_key": k})
        if r.status_code < 400:
            return {"ok": True, "detail": "Connected to TMDB ✓"}
        return {"ok": False, "detail": f"Invalid key (HTTP {r.status_code})"}
    except Exception as e:
        return {"ok": False, "detail": str(e)}


# ── series identity (search + id derivation) ─────────────────────────
class TMDBError(Exception):
    """TMDB could not answer; the message is safe to show to the user."""


class KeyMissing(TMDBError):
    def __init__(self):
        super().__init__(KEY_REQUIRED)


def _require_key() -> str:
    key = (settings.get("tmdb_key", "") or "").strip()
    if not key:
        raise KeyMissing()
    return key


async def _get(path: str, **params) -> dict:
    key = _require_key()
    try:
        async with http() as client:
            r = await client.get(f"{API}{path}", params={"api_key": key, **params})
    except httpx.HTTPError as e:
        log.warning("tmdb %s failed: %s", path, e)
        raise TMDBError(f"Could not reach TMDB: {e}") from e
    if r.status_code == 401:
        raise TMDBError("TMDB rejected the API key (HTTP 401). Check it in Settings.")
    if r.status_code >= 400:
        raise TMDBError(f"TMDB request failed (HTTP {r.status_code})")
    return r.json()


def _series_hit(item: dict) -> dict:
    return {
        "tmdb_id": item["id"],
        "title": item.get("name") or item.get("original_name") or "",
        "original_title": item.get("original_name") or "",
        "year": (item.get("first_air_date") or "")[:4],
        "poster": (IMG + "w154" + item["poster_path"]) if item.get("poster_path") else "",
    }


async def search_series(query: str) -> list[dict]:
    """Search TMDB TV by title in Catalan; fall back to English when nothing matches."""
    query = (query or "").strip()
    if not query:
        return []
    for language in SEARCH_LANGUAGES:
        j = await _get("/search/tv", query=query, language=language)
        hits = [_series_hit(it) for it in j.get("results") or [] if it.get("id")]
        if hits:
            return hits
    return []


@dataclass(frozen=True)
class SeriesIds:
    tvdb_id: int
    tmdb_id: int
    imdb_id: str | None
    title: str


def _as_id(value, name: str) -> int | None:
    if value in (None, ""):
        return None
    try:
        n = int(str(value).strip())
    except ValueError:
        raise TMDBError(f"{name} must be a number") from None
    if n <= 0:
        raise TMDBError(f"{name} must be a positive number")
    return n


async def _tmdb_id_for_tvdb(tvdb_id: int) -> tuple[int, str]:
    j = await _get(f"/find/{tvdb_id}", external_source="tvdb_id")
    hits = j.get("tv_results") or []
    if not hits:
        raise TMDBError(f"TMDB has no series with TVDB id {tvdb_id}")
    return hits[0]["id"], hits[0].get("name") or ""


async def series_ids(tmdb_id=None, tvdb_id=None) -> SeriesIds:
    """Resolve a series' TVDB/TMDB/IMDb ids from a picked TMDB id and/or a typed
    TVDB id. A typed TVDB id always wins over the one TMDB derives."""
    _require_key()
    tmdb_n, tvdb_n = _as_id(tmdb_id, "TMDB id"), _as_id(tvdb_id, "TVDB id")
    if tmdb_n is None and tvdb_n is None:
        raise TMDBError("Pick a series from the TMDB search or enter its TVDB id")
    title = ""
    if tmdb_n is None:
        tmdb_n, title = await _tmdb_id_for_tvdb(tvdb_n)
    ext = await _get(f"/tv/{tmdb_n}/external_ids")
    tvdb_n = tvdb_n or ext.get("tvdb_id")
    if not tvdb_n:
        raise TMDBError("TMDB has no TVDB id for this series. Enter the TVDB id manually.")
    return SeriesIds(tvdb_id=int(tvdb_n), tmdb_id=tmdb_n, imdb_id=ext.get("imdb_id") or None, title=title)


# ── films (movie channels) ───────────────────────────────────────────
MIN_TITLE_SIMILARITY = 0.9        # parsed vs TMDB title, accent/punctuation-insensitive
YEAR_TOLERANCE = 1                # TMDB's year filter matches any release date, not just the premiere
RELEASE_TITLE_LANGUAGE = "en-US"  # Radarr's primary metadata title, so its parser accepts the release


@dataclass(frozen=True)
class Film:
    tmdb_id: int
    imdb_id: str | None
    title: str            # English title: what the release is named after
    year: int | None


def _fold(text: str) -> str:
    """Lower-case, accent-free, punctuation-free text for fuzzy title comparison."""
    decomposed = unicodedata.normalize("NFKD", text or "")
    ascii_only = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return re.sub(r"[\W_]+", " ", ascii_only).strip().lower()


def _similar(a: str, b: str) -> bool:
    return bool(a and b) and SequenceMatcher(None, _fold(a), _fold(b)).ratio() >= MIN_TITLE_SIMILARITY


def _year_of(date: str | None) -> int | None:
    return int(date[:4]) if date and date[:4].isdigit() else None


def _movie_hit(item: dict) -> dict:
    return {
        "tmdb_id": item["id"],
        "title": item.get("title") or item.get("original_title") or "",
        "original_title": item.get("original_title") or "",
        "year": (item.get("release_date") or "")[:4],
        "poster": (IMG + "w154" + item["poster_path"]) if item.get("poster_path") else "",
    }


async def search_movies(query: str, year: int | None = None) -> list[dict]:
    """Search TMDB films in Catalan; fall back to English when nothing matches."""
    query = (query or "").strip()
    if not query:
        return []
    for language in SEARCH_LANGUAGES:
        hits = await _search_movie_in(language, query, year)
        if hits:
            return hits
    return []


async def _search_movie_in(language: str, query: str, year: int | None) -> list[dict]:
    extra = {"year": year} if year else {}
    j = await _get("/search/movie", query=query, language=language, **extra)
    return [_movie_hit(it) for it in j.get("results") or [] if it.get("id")]


def _is_confident(hit: dict, title: str, year: int) -> bool:
    hit_year = _year_of(hit["year"])
    return (hit_year is not None and abs(hit_year - year) <= YEAR_TOLERANCE
            and (_similar(title, hit["title"]) or _similar(title, hit["original_title"])))


async def film(tmdb_id) -> Film:
    """A film's ids, English title and year from its TMDB id."""
    tmdb_n = _as_id(tmdb_id, "TMDB id")
    if tmdb_n is None:
        raise TMDBError("TMDB id is required")
    j = await _get(f"/movie/{tmdb_n}", language=RELEASE_TITLE_LANGUAGE)
    return Film(tmdb_id=tmdb_n, imdb_id=j.get("imdb_id") or None,
                title=j.get("title") or j.get("original_title") or "", year=_year_of(j.get("release_date")))


async def film_for_imdb(imdb_id) -> Film:
    imdb = "tt" + str(imdb_id).strip().lower().lstrip("t")
    if not imdb[2:].isdigit():
        raise TMDBError("IMDb id must look like tt1234567")
    j = await _get(f"/find/{imdb}", external_source="imdb_id")
    hits = j.get("movie_results") or []
    if not hits:
        raise TMDBError(f"TMDB has no film with IMDb id {imdb}")
    return await film(hits[0]["id"])


async def match_film(title: str, year: int | None) -> Film | None:
    """The film a parsed title + year confidently names, or None.

    Confident = a TMDB hit (Catalan, then English) whose title or original title
    is near-identical and whose release year is within YEAR_TOLERANCE."""
    title = (title or "").strip()
    if not year or not title:
        return None
    for language in SEARCH_LANGUAGES:
        hits = await _search_movie_in(language, title, year)
        hit = next((h for h in hits if _is_confident(h, title, year)), None)
        if hit:
            return await film(hit["tmdb_id"])
    return None
