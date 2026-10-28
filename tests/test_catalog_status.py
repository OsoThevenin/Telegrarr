"""Catalog status: what Radarr already has of each film a movie channel offers.

The Catalog list is served first; its companion status endpoint reads Radarr's
movie list once and matches it by TMDB id. Driven over HTTP (``arr_app``) against
the fake Radarr (``arrs``) and fake TMDB (``fake_tmdb``).
"""
import pytest

from fake_arr import RADARR_KEY, radarr_movie
from fake_tmdb import API_KEY

MOVIE_CHAT = -1003333333333
THEORY_TMDB, THEORY_IMDB = 266856, "tt2980516"
PA_NEGRE_TMDB, PA_NEGRE_IMDB = 50797, "tt1302067"
RADARR = {"radarr_url": "http://radarr.test:7878", "radarr_key": RADARR_KEY}
MOVIE_LIST = "/api/v3/movie"


@pytest.fixture()
def films(fake_tmdb):
    fake_tmdb.add_movie(THEORY_TMDB, titles={"ca-ES": "La teoria del tot", "en-US": "The Theory of Everything"},
                        release_date="2014-11-07", imdb_id=THEORY_IMDB)
    fake_tmdb.add_movie(PA_NEGRE_TMDB, titles={"ca-ES": "Pa negre", "en-US": "Black Bread"},
                        original_title="Pa negre", release_date="2010-10-15", imdb_id=PA_NEGRE_IMDB)
    return fake_tmdb


async def _channel_offering(arr_app, *posts, radarr: dict | None = None) -> dict:
    """A movie channel whose posts (text, file name) are indexed; Radarr connected with ``radarr`` settings."""
    (await arr_app.http.patch("/api/settings", json={"tmdb_key": API_KEY, **(RADARR if radarr is None else radarr)})
     ).raise_for_status()
    arr_app.telegram.add_channel(MOVIE_CHAT, "Pel·lícules en català")
    channel = await arr_app.add_channel(MOVIE_CHAT, kind="movie")
    for text, file_name in posts:
        arr_app.telegram.post(MOVIE_CHAT, text=text, file_name=file_name)
    await arr_app.scan(channel["id"])
    return channel


THEORY_1080 = ("La teoria del tot (2014)", "La.teoria.del.tot.2014.1080p.mkv")
THEORY_2160 = ("La teoria del tot (2014) 2160p", "La.teoria.del.tot.2014.2160p.mkv")
PA_NEGRE_720 = ("Pa negre (2010)", "Pa_negre_2010_720p.mkv")


async def _status(arr_app, cid) -> dict:
    r = await arr_app.http.get(f"/api/channels/{cid}/catalog/status")
    assert r.status_code == 200, r.text
    return r.json()


def _by_tmdb(status: dict) -> dict:
    return {row["tmdb_id"]: row for row in status["rows"]}


@pytest.mark.asyncio
async def test_a_film_radarr_does_not_have_is_missing(arr_app, arrs, films):
    channel = await _channel_offering(arr_app, THEORY_1080)

    status = await _status(arr_app, channel["id"])

    assert status["radarr"] == {"available": True, "error": None}
    assert status["rows"] == [{"tmdb_id": THEORY_TMDB, "status": "missing"}]


@pytest.mark.asyncio
async def test_a_film_in_radarr_without_a_file_is_requested(arr_app, arrs, films):
    arrs.radarr.movies = [radarr_movie(1, THEORY_TMDB)]
    channel = await _channel_offering(arr_app, THEORY_1080)

    status = await _status(arr_app, channel["id"])

    assert status["rows"] == [{"tmdb_id": THEORY_TMDB, "status": "requested"}]


@pytest.mark.asyncio
async def test_a_file_at_the_channels_best_resolution_is_downloaded(arr_app, arrs, films):
    arrs.radarr.movies = [radarr_movie(1, THEORY_TMDB, resolution=1080)]
    channel = await _channel_offering(arr_app, THEORY_1080)

    status = await _status(arr_app, channel["id"])

    assert status["rows"] == [{"tmdb_id": THEORY_TMDB, "status": "downloaded", "radarr_quality": "1080p"}]


@pytest.mark.asyncio
async def test_a_file_above_the_channels_best_resolution_is_downloaded(arr_app, arrs, films):
    arrs.radarr.movies = [radarr_movie(1, PA_NEGRE_TMDB, resolution=1080)]
    channel = await _channel_offering(arr_app, PA_NEGRE_720)

    [row] = (await _status(arr_app, channel["id"]))["rows"]

    assert row == {"tmdb_id": PA_NEGRE_TMDB, "status": "downloaded", "radarr_quality": "1080p"}


@pytest.mark.asyncio
async def test_a_file_below_the_channels_best_is_an_upgrade_with_both_resolutions(arr_app, arrs, films):
    arrs.radarr.movies = [radarr_movie(1, THEORY_TMDB, resolution=720)]
    channel = await _channel_offering(arr_app, THEORY_1080)

    [row] = (await _status(arr_app, channel["id"]))["rows"]

    assert row == {"tmdb_id": THEORY_TMDB, "status": "upgrade", "radarr_quality": "720p", "best_quality": "1080p"}


@pytest.mark.asyncio
async def test_2160p_on_the_channel_is_an_upgrade_over_a_1080p_file(arr_app, arrs, films):
    arrs.radarr.movies = [radarr_movie(1, THEORY_TMDB, resolution=1080)]
    channel = await _channel_offering(arr_app, THEORY_1080, THEORY_2160)

    [row] = (await _status(arr_app, channel["id"]))["rows"]

    assert row == {"tmdb_id": THEORY_TMDB, "status": "upgrade", "radarr_quality": "1080p", "best_quality": "2160p"}


@pytest.mark.asyncio
async def test_an_unknown_resolution_ranks_as_sd(arr_app, arrs, films):
    from app import db

    arrs.radarr.movies = [radarr_movie(1, THEORY_TMDB, resolution=0),          # Radarr couldn't tell
                          radarr_movie(2, PA_NEGRE_TMDB, resolution=480)]
    channel = await _channel_offering(arr_app, THEORY_1080, PA_NEGRE_720)
    with db.conn() as c:     # a release from an older version, stored without a quality
        c.execute("UPDATE releases SET quality=NULL WHERE movie_tmdb_id=?", (PA_NEGRE_TMDB,))

    rows = _by_tmdb(await _status(arr_app, channel["id"]))

    assert rows[THEORY_TMDB] == {"tmdb_id": THEORY_TMDB, "status": "upgrade", "radarr_quality": "SD",
                                 "best_quality": "1080p"}
    assert rows[PA_NEGRE_TMDB] == {"tmdb_id": PA_NEGRE_TMDB, "status": "downloaded", "radarr_quality": "SD"}


@pytest.mark.asyncio
async def test_radarrs_movie_list_is_read_once_per_load_whatever_the_number_of_rows(arr_app, arrs, films):
    arrs.radarr.movies = [radarr_movie(1, THEORY_TMDB, resolution=1080), radarr_movie(2, 999)]
    channel = await _channel_offering(arr_app, THEORY_1080, PA_NEGRE_720,
                                      ("", "La.casa.del.llac.mkv"))          # plus a Cal identificar row

    status = await _status(arr_app, channel["id"])

    assert set(_by_tmdb(status)) == {THEORY_TMDB, PA_NEGRE_TMDB}
    assert [r.url.path for r in arrs.radarr.requests] == [MOVIE_LIST]


@pytest.mark.asyncio
async def test_reading_the_status_asks_telegram_nothing(arr_app, arrs, films):
    channel = await _channel_offering(arr_app, THEORY_1080, ("", "La.casa.del.llac.mkv"))
    tg = arr_app.telegram
    before = (len(tg.lookups), len(tg.requests), len(tg.history_reads))

    await _status(arr_app, channel["id"])

    assert (len(tg.lookups), len(tg.requests), len(tg.history_reads)) == before


@pytest.mark.asyncio
async def test_radarr_unconfigured_lists_the_films_with_no_status(arr_app, arrs, films):
    channel = await _channel_offering(arr_app, THEORY_1080, radarr={})

    status = await _status(arr_app, channel["id"])

    assert status["radarr"] == {"available": False, "error": {"key": "err.arr.not_set", "params": {"app": "Radarr"}}}
    assert status["rows"] == []
    assert (await arr_app.http.get(f"/api/channels/{channel['id']}/catalog")).json()["count"] == 1
    assert arrs.radarr.requests == []


@pytest.mark.asyncio
async def test_radarr_unreachable_is_unavailable_with_its_reason(arr_app, arrs, films):
    channel = await _channel_offering(arr_app, THEORY_1080,
                                      radarr={"radarr_url": "http://nowhere.test:7878", "radarr_key": RADARR_KEY})

    status = await _status(arr_app, channel["id"])

    assert status["radarr"]["available"] is False
    assert status["radarr"]["error"]["key"] == "err.arr.unreachable"
    assert status["rows"] == []


@pytest.mark.asyncio
async def test_radarr_refusing_the_key_is_unavailable_with_its_reason(arr_app, arrs, films):
    channel = await _channel_offering(arr_app, THEORY_1080, radarr={**RADARR, "radarr_key": "wrong-key"})

    status = await _status(arr_app, channel["id"])

    assert status["radarr"] == {"available": False, "error": {"key": "err.arr.bad_key", "params": {"app": "Radarr"}}}
    assert status["rows"] == []
    assert [r.url.path for r in arrs.radarr.requests] == [MOVIE_LIST]


@pytest.mark.asyncio
async def test_radarr_answering_something_other_than_a_movie_list_is_unavailable(arr_app, arrs, films):
    arrs.radarr.movies = {"message": "not a list"}
    channel = await _channel_offering(arr_app, THEORY_1080)

    status = await _status(arr_app, channel["id"])

    assert status["radarr"]["available"] is False
    assert status["radarr"]["error"]["key"] == "err.arr.bad_shape"
    assert status["rows"] == []


@pytest.mark.asyncio
async def test_the_status_of_a_series_channel_is_a_keyed_error(arr_app, arrs):
    arr_app.telegram.add_channel(MOVIE_CHAT, "Sèries")
    series = await arr_app.add_channel(MOVIE_CHAT, kind="tv")

    r = await arr_app.http.get(f"/api/channels/{series['id']}/catalog/status")

    assert r.status_code == 400
    assert r.json()["detail"] == {"key": "err.catalog.not_movie_channel", "params": {}}
    assert arrs.radarr.requests == []


@pytest.mark.asyncio
async def test_the_status_of_an_unknown_channel_is_a_keyed_error(arr_app, arrs):
    r = await arr_app.http.get("/api/channels/999/catalog/status")

    assert r.status_code == 404
    assert r.json()["detail"] == {"key": "err.catalog.unknown_channel", "params": {"id": 999}}


@pytest.mark.asyncio
async def test_the_catalog_module_fills_rows_from_the_status_endpoint_and_links_to_connect(arr_app):
    module = (await arr_app.http.get("/static/js/catalog.js")).raise_for_status().text

    assert "/catalog/status`" in module
    assert '"#/connect"' in module          # the Radarr no connectat notice's Obre Connecta


@pytest.mark.asyncio
async def test_the_status_needs_a_signed_in_user(arr_app, arrs):
    arr_app.http.cookies.clear()

    r = await arr_app.http.get("/api/channels/1/catalog/status")

    assert r.status_code == 401
