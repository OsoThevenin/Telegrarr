"""External Radarr/Sonarr URLs: the addresses a browser can open, which may differ from the
ones Telegrarr connects to (an internal Docker hostname). Each Catalog film carries a ready-made
Radarr link. Driven over HTTP (``arr_app``) against the fake Radarr and fake TMDB.
"""
import pytest

from fake_arr import RADARR_KEY
from fake_tmdb import API_KEY

MOVIE_CHAT = -1003333333333
THEORY_TMDB = 266856
INTERNAL = "http://radarr.test:7878"
EXTERNAL = "https://radarr.example.com"
RADARR = {"radarr_url": INTERNAL, "radarr_key": RADARR_KEY}


async def _catalog_film(arr_app, fake_tmdb, settings: dict) -> dict:
    """The only row of a movie channel's Catalog, with ``settings`` applied."""
    fake_tmdb.add_movie(THEORY_TMDB, titles={"ca-ES": "La teoria del tot", "en-US": "The Theory of Everything"},
                        release_date="2014-11-07", imdb_id="tt2980516")
    (await arr_app.http.patch("/api/settings", json={"tmdb_key": API_KEY, **settings})).raise_for_status()
    arr_app.telegram.add_channel(MOVIE_CHAT, "Pel·lícules en català")
    channel = await arr_app.add_channel(MOVIE_CHAT, kind="movie")
    arr_app.telegram.post(MOVIE_CHAT, text="La teoria del tot (2014)", file_name="La.teoria.del.tot.2014.1080p.mkv")
    await arr_app.scan(channel["id"])
    r = await arr_app.http.get(f"/api/channels/{channel['id']}/catalog")
    assert r.status_code == 200, r.text
    rows = r.json()["rows"]
    assert len(rows) == 1
    return rows[0]


@pytest.mark.asyncio
async def test_external_urls_are_unset_by_default(arr_app):
    settings = await arr_app.settings()

    assert settings["radarr_external_url"] == ""
    assert settings["sonarr_external_url"] == ""


@pytest.mark.asyncio
async def test_settings_save_and_return_external_urls(arr_app):
    r = await arr_app.http.patch("/api/settings", json={"radarr_external_url": "https://radarr.example.com/",
                                                        "sonarr_external_url": "https://sonarr.example.com"})

    assert r.status_code == 200, r.text
    settings = await arr_app.settings()
    assert settings["radarr_external_url"] == EXTERNAL
    assert settings["sonarr_external_url"] == "https://sonarr.example.com"


@pytest.mark.asyncio
async def test_an_external_url_can_be_cleared(arr_app):
    await arr_app.http.patch("/api/settings", json={"radarr_external_url": EXTERNAL})

    await arr_app.http.patch("/api/settings", json={"radarr_external_url": ""})

    assert (await arr_app.settings())["radarr_external_url"] == ""


@pytest.mark.asyncio
@pytest.mark.parametrize("field", ["radarr_external_url", "sonarr_external_url"])
async def test_non_http_external_url_is_rejected(arr_app, field):
    r = await arr_app.http.patch("/api/settings", json={field: "javascript:alert(1)"})

    assert r.status_code == 400
    assert r.json()["detail"]["key"] == "err.settings.url_scheme"
    assert (await arr_app.settings())[field] == ""


@pytest.mark.asyncio
async def test_catalog_film_links_to_the_external_url_when_set(arr_app, arrs, fake_tmdb):
    film = await _catalog_film(arr_app, fake_tmdb, {**RADARR, "radarr_external_url": EXTERNAL})

    assert film["radarr_link"] == f"https://radarr.example.com/movie/{THEORY_TMDB}"


@pytest.mark.asyncio
async def test_catalog_film_link_falls_back_to_the_connection_url(arr_app, arrs, fake_tmdb):
    film = await _catalog_film(arr_app, fake_tmdb, RADARR)

    assert film["radarr_link"] == f"http://radarr.test:7878/movie/{THEORY_TMDB}"


@pytest.mark.asyncio
async def test_catalog_film_has_no_link_when_radarr_is_not_configured(arr_app, arrs, fake_tmdb):
    film = await _catalog_film(arr_app, fake_tmdb, {})

    assert film["radarr_link"] is None
