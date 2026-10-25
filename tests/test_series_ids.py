"""Series channels are mapped to TVDB/TMDB/IMDb ids, and Sonarr finds releases by id.

Driven over HTTP (``arr_app``) with TMDB faked at the httpx transport level
(``fake_tmdb``).
"""
import xml.etree.ElementTree as ET

import pytest

from fake_tmdb import API_KEY

NEWZNAB_NS = "{http://www.newznab.com/DTD/2010/feeds/attributes/}"
SHOW_CHAT = -1001111111111
OTHER_CHAT = -1002222222222


def _supported_params(caps: str, element: str) -> set[str]:
    node = ET.fromstring(caps).find(f"./searching/{element}")
    return set(node.attrib["supportedParams"].split(","))


@pytest.mark.asyncio
async def test_caps_advertise_tvdb_tmdb_and_imdb_ids(arr_app):
    caps = (await arr_app.http.get("/api/newznab", params={"t": "caps"})).text

    assert {"tvdbid", "tmdbid", "imdbid"} <= _supported_params(caps, "tv-search")
    assert {"tmdbid", "imdbid"} <= _supported_params(caps, "movie-search")


async def _save_tmdb_key(arr_app, key=API_KEY):
    (await arr_app.http.patch("/api/settings", json={"tmdb_key": key})).raise_for_status()


@pytest.mark.asyncio
async def test_tmdb_search_finds_series_by_catalan_title(arr_app, fake_tmdb):
    fake_tmdb.add_series(61662, titles={"ca-ES": "Merlí", "en-US": "Merlí"}, first_air_date="2015-09-14")
    fake_tmdb.add_series(1399, titles={"ca-ES": "Joc de trons", "en-US": "Game of Thrones"},
                         first_air_date="2011-04-17")
    await _save_tmdb_key(arr_app)

    r = await arr_app.http.get("/api/tmdb/search", params={"q": "joc de trons"})

    assert r.status_code == 200
    hits = r.json()
    assert [(h["tmdb_id"], h["title"], h["year"]) for h in hits] == [(1399, "Joc de trons", "2011")]
    assert fake_tmdb.searches() == [("joc de trons", "ca-ES")]


@pytest.mark.asyncio
async def test_tmdb_search_falls_back_to_english_when_catalan_finds_nothing(arr_app, fake_tmdb):
    fake_tmdb.add_series(1396, titles={"en-US": "Breaking Bad"}, first_air_date="2008-01-20")
    await _save_tmdb_key(arr_app)

    r = await arr_app.http.get("/api/tmdb/search", params={"q": "breaking bad"})

    assert [(h["tmdb_id"], h["title"]) for h in r.json()] == [(1396, "Breaking Bad")]
    assert fake_tmdb.searches() == [("breaking bad", "ca-ES"), ("breaking bad", "en-US")]


@pytest.mark.asyncio
async def test_tmdb_search_without_key_says_a_key_is_required(arr_app, fake_tmdb):
    r = await arr_app.http.get("/api/tmdb/search", params={"q": "merlí"})

    assert r.status_code == 400
    assert "TMDB API key is required" in r.json()["detail"]
    assert fake_tmdb.requests == []
