"""Catalog file details: what the file Radarr holds for a film is like, from Radarr's
single movie list. Driven over HTTP (``arr_app``) against the fake Radarr (``arrs``)."""
import pytest

from fake_arr import RADARR_KEY, radarr_file_details, radarr_movie
from fake_tmdb import API_KEY

MOVIE_CHAT = -1003333333333
THEORY_TMDB, PA_NEGRE_TMDB = 266856, 50797
THEORY_POST = ("La teoria del tot (2014)", "La.teoria.del.tot.2014.1080p.mkv")
PA_NEGRE_POST = ("Pa negre (2010)", "Pa_negre_2010_720p.mkv")
THEORY_FILE = radarr_file_details(size=4_500_000_000, relative_path="The Theory (2014) WEBDL-1080p.mkv",
                                  resolution="1920x800", video_codec="x265",
                                  audio_languages="cat/eng", subtitles="cat/spa")


@pytest.fixture()
def films(fake_tmdb):
    fake_tmdb.add_movie(THEORY_TMDB, titles={"ca-ES": "La teoria del tot"},
                        release_date="2014-11-07", imdb_id="tt2980516")
    fake_tmdb.add_movie(PA_NEGRE_TMDB, titles={"ca-ES": "Pa negre"}, original_title="Pa negre",
                        release_date="2010-10-15", imdb_id="tt1302067")
    return fake_tmdb


async def _channel_offering(arr_app, *posts) -> dict:
    settings = {"tmdb_key": API_KEY, "radarr_url": "http://radarr.test:7878", "radarr_key": RADARR_KEY}
    (await arr_app.http.patch("/api/settings", json=settings)).raise_for_status()
    arr_app.telegram.add_channel(MOVIE_CHAT, "Pel·lícules en català")
    channel = await arr_app.add_channel(MOVIE_CHAT, kind="movie")
    for text, file_name in posts:
        arr_app.telegram.post(MOVIE_CHAT, text=text, file_name=file_name)
    await arr_app.scan(channel["id"])
    return channel


async def _status_rows(arr_app, channel) -> dict:
    r = await arr_app.http.get(f"/api/channels/{channel['id']}/catalog/status")
    assert r.status_code == 200, r.text
    return {row["tmdb_id"]: row for row in r.json()["rows"]}


@pytest.mark.asyncio
async def test_a_film_with_a_radarr_file_carries_that_files_details(arr_app, arrs, films):
    arrs.radarr.movies = [radarr_movie(1, THEORY_TMDB, resolution=1080, file_details=THEORY_FILE)]
    channel = await _channel_offering(arr_app, THEORY_POST)

    rows = await _status_rows(arr_app, channel)

    assert rows[THEORY_TMDB]["file"] == {
        "quality": "1080p", "resolution": "1920x800", "video_codec": "x265", "container": "mkv",
        "audio_languages": ["cat", "eng"], "subtitle_languages": ["cat", "spa"],
        "size": 4_500_000_000}


@pytest.mark.asyncio
async def test_a_film_without_a_radarr_file_carries_no_file_details(arr_app, arrs, films):
    arrs.radarr.movies = [radarr_movie(1, THEORY_TMDB)]
    channel = await _channel_offering(arr_app, THEORY_POST, PA_NEGRE_POST)

    rows = await _status_rows(arr_app, channel)

    assert "file" not in rows[THEORY_TMDB]      # in Radarr, no file yet
    assert "file" not in rows[PA_NEGRE_TMDB]    # not in Radarr at all


@pytest.mark.asyncio
async def test_a_file_radarr_has_not_scanned_reports_unknown_details(arr_app, arrs, films):
    arrs.radarr.movies = [radarr_movie(1, THEORY_TMDB, resolution=1080)]
    channel = await _channel_offering(arr_app, THEORY_POST)

    rows = await _status_rows(arr_app, channel)

    assert rows[THEORY_TMDB]["file"] == {
        "quality": "1080p", "resolution": None, "video_codec": None, "container": None,
        "audio_languages": [], "subtitle_languages": [], "size": None}


@pytest.mark.asyncio
async def test_a_status_filtered_page_keeps_the_release_size_apart_from_the_file_details(arr_app, arrs, films):
    arrs.radarr.movies = [radarr_movie(1, THEORY_TMDB, resolution=1080, file_details=THEORY_FILE)]
    channel = await _channel_offering(arr_app, THEORY_POST)

    r = await arr_app.http.get(f"/api/channels/{channel['id']}/catalog", params={"filter": "downloaded"})

    row = r.json()["rows"][0]
    assert row["file"]["size"] == 4_500_000_000
    assert row["size"] != 4_500_000_000


@pytest.mark.asyncio
async def test_the_details_of_every_film_come_from_one_radarr_movie_list_call(arr_app, arrs, films):
    arrs.radarr.movies = [radarr_movie(1, THEORY_TMDB, resolution=1080, file_details=THEORY_FILE),
                          radarr_movie(2, PA_NEGRE_TMDB, resolution=720, file_details=THEORY_FILE)]
    channel = await _channel_offering(arr_app, THEORY_POST, PA_NEGRE_POST)
    arrs.radarr.requests.clear()

    rows = await _status_rows(arr_app, channel)

    assert all("file" in row for row in rows.values())
    assert [r.url.path for r in arrs.radarr.requests] == ["/api/v3/movie"]
