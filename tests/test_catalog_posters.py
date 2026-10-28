"""Catalog posters: each identified film's 2:3 thumbnail, resolved apart from the
Catalog itself (GET /api/channels/{cid}/catalog/posters) so the list never waits on art.

Radarr's poster wins when Radarr has the film; otherwise the TMDB poster, cached so
reopening a Catalog asks TMDB nothing new. No poster → null (the UI's placeholder tile).
Driven over HTTP (``arr_app``) with TMDB, Radarr and Telegram faked at the wire.
"""
import pytest

from fake_arr import RADARR_KEY
from fake_tmdb import API_KEY

MOVIE_CHAT = -1003333333333
THEORY_TMDB, THEORY_IMDB = 266856, "tt2980516"
PA_NEGRE_TMDB, PA_NEGRE_IMDB = 50797, "tt1302067"
TMDB_THUMB = "https://image.tmdb.org/t/p/w185"
RADARR_URL = "http://radarr.test:7878"
RADARR_POSTER = "https://image.tmdb.org/t/p/original/radarr-theory.jpg"


@pytest.fixture(autouse=True)
def empty_poster_caches(monkeypatch):
    from app import tmdb
    monkeypatch.setattr(tmdb, "_cache", {})
    monkeypatch.setattr(tmdb, "_poster_cache", {})


@pytest.fixture()
def films(fake_tmdb):
    fake_tmdb.add_movie(THEORY_TMDB, titles={"ca-ES": "La teoria del tot", "en-US": "The Theory of Everything"},
                        release_date="2014-11-07", imdb_id=THEORY_IMDB)
    fake_tmdb.add_movie(PA_NEGRE_TMDB, titles={"ca-ES": "Pa negre", "en-US": "Black Bread"},
                        original_title="Pa negre", release_date="2010-10-15", imdb_id=PA_NEGRE_IMDB)
    return fake_tmdb


def _radarr_movie(tmdb_id: int, title: str, poster: str | None) -> dict:
    images = [{"coverType": "fanart", "remoteUrl": "https://example.test/fanart.jpg"}]
    if poster:
        images.append({"coverType": "poster", "url": f"/MediaCover/{tmdb_id}/poster.jpg", "remoteUrl": poster})
    return {"id": tmdb_id % 1000, "tmdbId": tmdb_id, "title": title, "year": 2014, "hasFile": False, "images": images}


async def _indexed_channel(arr_app) -> dict:
    """A movie channel offering The Theory of Everything and Pa negre, already scanned."""
    (await arr_app.http.patch("/api/settings", json={"tmdb_key": API_KEY})).raise_for_status()
    arr_app.telegram.add_channel(MOVIE_CHAT, "Pel·lícules en català")
    channel = await arr_app.add_channel(MOVIE_CHAT, kind="movie")
    arr_app.telegram.post(MOVIE_CHAT, text="La teoria del tot (2014)", file_name="La.teoria.del.tot.2014.1080p.mkv")
    arr_app.telegram.post(MOVIE_CHAT, text="Pa negre (2010)", file_name="Pa.negre.2010.720p.mkv")
    await arr_app.scan(channel["id"])
    return channel


async def _connect_radarr(arr_app, url: str = RADARR_URL) -> None:
    (await arr_app.http.patch("/api/settings", json={"radarr_url": url, "radarr_key": RADARR_KEY})).raise_for_status()


async def _posters(arr_app, cid) -> dict:
    r = await arr_app.http.get(f"/api/channels/{cid}/catalog/posters")
    assert r.status_code == 200, r.text
    return r.json()["posters"]


@pytest.mark.asyncio
async def test_a_film_radarr_has_uses_radarrs_poster_and_tmdb_is_not_asked(arr_app, arrs, films):
    channel = await _indexed_channel(arr_app)
    await _connect_radarr(arr_app)
    arrs.radarr.movies = [_radarr_movie(THEORY_TMDB, "The Theory of Everything", RADARR_POSTER)]
    asked_before = len(films.movie_details_requests())

    posters = await _posters(arr_app, channel["id"])

    assert posters[str(THEORY_TMDB)] == RADARR_POSTER
    assert THEORY_TMDB not in films.movie_details_requests()[asked_before:]


@pytest.mark.asyncio
async def test_without_radarr_each_film_falls_back_to_its_tmdb_poster(arr_app, arrs, films):
    channel = await _indexed_channel(arr_app)

    posters = await _posters(arr_app, channel["id"])

    assert posters == {str(THEORY_TMDB): f"{TMDB_THUMB}/movie{THEORY_TMDB}.jpg",
                       str(PA_NEGRE_TMDB): f"{TMDB_THUMB}/movie{PA_NEGRE_TMDB}.jpg"}


@pytest.mark.asyncio
async def test_a_film_radarr_lacks_or_has_without_a_poster_falls_back_to_tmdb(arr_app, arrs, films):
    channel = await _indexed_channel(arr_app)
    await _connect_radarr(arr_app)
    arrs.radarr.movies = [_radarr_movie(THEORY_TMDB, "The Theory of Everything", poster=None)]

    posters = await _posters(arr_app, channel["id"])

    assert posters == {str(THEORY_TMDB): f"{TMDB_THUMB}/movie{THEORY_TMDB}.jpg",
                       str(PA_NEGRE_TMDB): f"{TMDB_THUMB}/movie{PA_NEGRE_TMDB}.jpg"}


@pytest.mark.asyncio
async def test_an_unreachable_radarr_falls_back_to_tmdb(arr_app, arrs, films):
    channel = await _indexed_channel(arr_app)
    await _connect_radarr(arr_app, url="http://nowhere.test:7878")

    posters = await _posters(arr_app, channel["id"])

    assert posters[str(THEORY_TMDB)] == f"{TMDB_THUMB}/movie{THEORY_TMDB}.jpg"


@pytest.mark.asyncio
async def test_reopening_a_catalog_reuses_the_cached_posters_without_asking_tmdb_again(arr_app, arrs, films):
    channel = await _indexed_channel(arr_app)
    asked_before = len(films.movie_details_requests())

    first = await _posters(arr_app, channel["id"])
    asked_once = films.movie_details_requests()[asked_before:]
    second = await _posters(arr_app, channel["id"])

    assert sorted(asked_once) == sorted([THEORY_TMDB, PA_NEGRE_TMDB])
    assert films.movie_details_requests()[asked_before + len(asked_once):] == []
    assert second == first


@pytest.mark.asyncio
async def test_a_film_tmdb_has_no_art_for_has_no_poster(arr_app, arrs, fake_tmdb):
    fake_tmdb.add_movie(THEORY_TMDB, titles={"ca-ES": "La teoria del tot", "en-US": "The Theory of Everything"},
                        release_date="2014-11-07", imdb_id=THEORY_IMDB, has_poster=False)
    channel = await _indexed_channel(arr_app)

    assert await _posters(arr_app, channel["id"]) == {str(THEORY_TMDB): None}


@pytest.mark.asyncio
async def test_without_a_tmdb_key_films_have_no_poster_and_tmdb_is_not_asked(arr_app, arrs, films):
    channel = await _indexed_channel(arr_app)
    (await arr_app.http.patch("/api/settings", json={"tmdb_key": ""})).raise_for_status()
    asked_before = len(films.requests)

    posters = await _posters(arr_app, channel["id"])

    assert posters == {str(THEORY_TMDB): None, str(PA_NEGRE_TMDB): None}
    assert len(films.requests) == asked_before


@pytest.mark.asyncio
async def test_a_failing_tmdb_leaves_films_without_poster_and_the_catalog_still_lists_them(arr_app, arrs, films):
    channel = await _indexed_channel(arr_app)
    (await arr_app.http.patch("/api/settings", json={"tmdb_key": "rejected-key"})).raise_for_status()

    posters = await _posters(arr_app, channel["id"])
    catalog = await arr_app.http.get(f"/api/channels/{channel['id']}/catalog")

    assert posters == {str(THEORY_TMDB): None, str(PA_NEGRE_TMDB): None}
    assert catalog.status_code == 200 and catalog.json()["count"] == 2


@pytest.mark.asyncio
async def test_the_catalog_itself_never_waits_on_poster_lookups(arr_app, arrs, films):
    channel = await _indexed_channel(arr_app)
    await _connect_radarr(arr_app)
    tmdb_before, radarr_before = len(films.requests), len(arrs.radarr.requests)

    r = await arr_app.http.get(f"/api/channels/{channel['id']}/catalog")

    assert r.status_code == 200
    assert (len(films.requests), len(arrs.radarr.requests)) == (tmdb_before, radarr_before)


@pytest.mark.asyncio
async def test_resolving_posters_asks_telegram_nothing(arr_app, arrs, films):
    channel = await _indexed_channel(arr_app)
    telegram = arr_app.telegram
    before = (len(telegram.lookups), len(telegram.requests), len(telegram.history_reads))

    await _posters(arr_app, channel["id"])

    assert (len(telegram.lookups), len(telegram.requests), len(telegram.history_reads)) == before


@pytest.mark.asyncio
async def test_posters_of_an_unknown_channel_are_a_keyed_error(arr_app):
    r = await arr_app.http.get("/api/channels/999/catalog/posters")

    assert r.status_code == 404
    assert r.json()["detail"] == {"key": "err.catalog.unknown_channel", "params": {"id": 999}}


@pytest.mark.asyncio
async def test_the_catalog_module_fetches_posters_and_labels_them(arr_app):
    module = await arr_app.http.get("/static/js/catalog.js")

    assert module.status_code == 200
    assert "/catalog/posters" in module.text
    assert "cat.poster_of" in module.text
