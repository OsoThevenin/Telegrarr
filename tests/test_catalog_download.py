"""Catalog Download (Baixar): asking Radarr for a film a movie channel offers.

A film Radarr lacks is added (monitored, the Connect page's profile and root
folder, search on add); a film Radarr has is only searched again. Either way a
local requested marker is saved, so the row reads Sol·licitada after a reload.
Driven over HTTP (``arr_app``) against the fake Radarr (``arrs``), asserting the
payloads Radarr received.
"""
import pytest

from fake_arr import RADARR_KEY, radarr_movie
from fake_tmdb import API_KEY

MOVIE_CHAT = -1004444444444
THEORY_TMDB, THEORY_IMDB = 266856, "tt2980516"
RADARR = {"radarr_url": "http://radarr.test:7878", "radarr_key": RADARR_KEY}
THEORY_1080 = ("La teoria del tot (2014)", "La.teoria.del.tot.2014.1080p.mkv")


@pytest.fixture()
def films(fake_tmdb):
    fake_tmdb.add_movie(THEORY_TMDB, titles={"ca-ES": "La teoria del tot", "en-US": "The Theory of Everything"},
                        release_date="2014-11-07", imdb_id=THEORY_IMDB)
    return fake_tmdb


def _radarr_with_choices(arrs) -> None:
    arrs.radarr.quality_profiles = [{"id": 4, "name": "HD-1080p"}, {"id": 7, "name": "Ultra-HD"}]
    arrs.radarr.root_folders = [{"id": 1, "path": "/movies", "freeSpace": 1},
                                {"id": 2, "path": "/movies4k", "freeSpace": 2}]


async def _channel_offering_theory(arr_app, radarr: dict | None = None) -> dict:
    (await arr_app.http.patch("/api/settings", json={"tmdb_key": API_KEY, **(RADARR if radarr is None else radarr)})
     ).raise_for_status()
    arr_app.telegram.add_channel(MOVIE_CHAT, "Pel·lícules en català")
    channel = await arr_app.add_channel(MOVIE_CHAT, kind="movie")
    arr_app.telegram.post(MOVIE_CHAT, text=THEORY_1080[0], file_name=THEORY_1080[1])
    await arr_app.scan(channel["id"])
    return channel


def _download(arr_app, cid, tmdb_id=THEORY_TMDB):
    return arr_app.http.post(f"/api/channels/{cid}/catalog/{tmdb_id}/download")


@pytest.mark.asyncio
async def test_a_film_radarr_lacks_is_added_once_monitored_with_the_selected_defaults(arr_app, arrs, films):
    _radarr_with_choices(arrs)
    channel = await _channel_offering_theory(arr_app)
    await arr_app.http.put("/api/connect/radarr/defaults", json={"quality_profile_id": 7, "root_folder": "/movies4k"})

    r = await _download(arr_app, channel["id"])

    assert r.status_code == 200, r.text
    assert r.json() == {"tmdb_id": THEORY_TMDB, "action": "added"}
    [added] = arrs.radarr.added_movies()
    assert added["tmdbId"] == THEORY_TMDB
    assert added["monitored"] is True
    assert added["qualityProfileId"] == 7
    assert added["rootFolderPath"] == "/movies4k"
    assert added["addOptions"]["searchForMovie"] is True
    assert added["title"]                           # Radarr's own lookup supplied the movie fields
    assert arrs.radarr.commands() == []


async def _status_of_theory(arr_app, cid) -> dict:
    r = await arr_app.http.get(f"/api/channels/{cid}/catalog/status")
    assert r.status_code == 200, r.text
    return next(row for row in r.json()["rows"] if row["tmdb_id"] == THEORY_TMDB)


@pytest.mark.asyncio
async def test_a_film_radarr_has_is_only_searched_again_with_its_settings_untouched(arr_app, arrs, films):
    _radarr_with_choices(arrs)
    arrs.radarr.movies = [radarr_movie(12, THEORY_TMDB, resolution=720)]      # an upgrade
    channel = await _channel_offering_theory(arr_app)

    r = await _download(arr_app, channel["id"])

    assert r.status_code == 200, r.text
    assert r.json() == {"tmdb_id": THEORY_TMDB, "action": "searched"}
    assert arrs.radarr.added_movies() == []
    assert arrs.radarr.commands() == [{"name": "MoviesSearch", "movieIds": [12]}]
    assert [req.method for req in arrs.radarr.requests if req.method not in ("GET", "POST")] == []   # no PUT


@pytest.mark.asyncio
async def test_pressing_twice_leaves_one_movie_in_radarr_and_no_error(arr_app, arrs, films):
    _radarr_with_choices(arrs)
    channel = await _channel_offering_theory(arr_app)

    first, second = await _download(arr_app, channel["id"]), await _download(arr_app, channel["id"])

    assert (first.status_code, second.status_code) == (200, 200)
    assert [m["tmdbId"] for m in arrs.radarr.movies] == [THEORY_TMDB]
    assert len(arrs.radarr.added_movies()) == 1
    assert arrs.radarr.commands() == [{"name": "MoviesSearch", "movieIds": [arrs.radarr.movies[0]["id"]]}]


@pytest.mark.asyncio
async def test_a_requested_film_radarr_does_not_list_yet_reads_requested_after_a_reload(arr_app, arrs, films):
    _radarr_with_choices(arrs)
    channel = await _channel_offering_theory(arr_app)
    (await _download(arr_app, channel["id"])).raise_for_status()
    arrs.radarr.movies = []                     # Radarr doesn't list the film (yet)

    assert await _status_of_theory(arr_app, channel["id"]) == {"tmdb_id": THEORY_TMDB, "status": "requested"}


@pytest.mark.asyncio
async def test_once_radarr_has_the_file_radarrs_state_wins_over_the_marker(arr_app, arrs, films):
    _radarr_with_choices(arrs)
    channel = await _channel_offering_theory(arr_app)
    (await _download(arr_app, channel["id"])).raise_for_status()
    arrs.radarr.movies = [radarr_movie(1, THEORY_TMDB, resolution=1080)]

    assert await _status_of_theory(arr_app, channel["id"]) == {"tmdb_id": THEORY_TMDB, "status": "downloaded",
                                                                "radarr_quality": "1080p"}


# ── a requested upgrade ───────────────────────────────────────────────
FILE_BEFORE_REQUEST = "2020-01-01T00:00:00Z"
FILE_AFTER_REQUEST = "2099-01-01T00:00:00Z"
REQUESTED_UPGRADE = {"tmdb_id": THEORY_TMDB, "status": "requested", "radarr_quality": "720p",
                     "best_quality": "1080p"}


def _radarr_has_theory_at(arrs, resolution: int, file_added: str) -> None:
    arrs.radarr.movies = [radarr_movie(12, THEORY_TMDB, resolution=resolution, file_added=file_added)]


async def _reopened_drawer(arr_app, cid) -> tuple[dict, dict]:
    """What a fresh drawer opening reads: the list's first page, then the status."""
    catalog = await arr_app.http.get(f"/api/channels/{cid}/catalog")
    assert catalog.status_code == 200, catalog.text
    return catalog.json(), await _status_of_theory(arr_app, cid)


@pytest.mark.asyncio
async def test_a_requested_upgrade_reads_requested_with_its_baixada_quality_before_and_after_a_reload(
        arr_app, arrs, films):
    _radarr_with_choices(arrs)
    _radarr_has_theory_at(arrs, 720, FILE_BEFORE_REQUEST)
    channel = await _channel_offering_theory(arr_app)
    (await _download(arr_app, channel["id"])).raise_for_status()

    right_after = await _status_of_theory(arr_app, channel["id"])     # the UI's re-read after Baixar
    _, reopened = await _reopened_drawer(arr_app, channel["id"])

    assert right_after == REQUESTED_UPGRADE
    assert reopened == REQUESTED_UPGRADE


@pytest.mark.asyncio
async def test_a_requested_upgrade_counts_as_downloaded_not_as_an_upgrade(arr_app, arrs, films):
    _radarr_with_choices(arrs)
    _radarr_has_theory_at(arrs, 720, FILE_BEFORE_REQUEST)
    channel = await _channel_offering_theory(arr_app)
    (await _download(arr_app, channel["id"])).raise_for_status()
    page = f"/api/channels/{channel['id']}/catalog"

    downloaded = (await arr_app.http.get(page, params={"filter": "downloaded"})).json()
    upgrade = (await arr_app.http.get(page, params={"filter": "upgrade"})).json()

    assert [(r["tmdb_id"], r["status"]) for r in downloaded["rows"]] == [(THEORY_TMDB, "requested")]
    assert upgrade["rows"] == []
    assert downloaded["counts"] == {"all": 1, "missing": 0, "downloaded": 1, "upgrade": 0}


@pytest.mark.asyncio
async def test_once_radarrs_file_reaches_the_channels_best_the_marker_is_dropped(arr_app, arrs, films):
    _radarr_with_choices(arrs)
    _radarr_has_theory_at(arrs, 720, FILE_BEFORE_REQUEST)
    channel = await _channel_offering_theory(arr_app)
    (await _download(arr_app, channel["id"])).raise_for_status()
    _radarr_has_theory_at(arrs, 1080, FILE_AFTER_REQUEST)
    assert (await _status_of_theory(arr_app, channel["id"]))["status"] == "downloaded"

    _radarr_has_theory_at(arrs, 720, FILE_BEFORE_REQUEST)       # the marker no longer counts

    assert await _status_of_theory(arr_app, channel["id"]) == {
        "tmdb_id": THEORY_TMDB, "status": "upgrade", "radarr_quality": "720p", "best_quality": "1080p"}


@pytest.mark.asyncio
async def test_a_file_below_the_best_that_arrived_after_the_request_ends_it(arr_app, arrs, films):
    _radarr_with_choices(arrs)
    channel = await _channel_offering_theory(arr_app)
    (await _download(arr_app, channel["id"])).raise_for_status()

    _radarr_has_theory_at(arrs, 720, FILE_AFTER_REQUEST)

    assert (await _status_of_theory(arr_app, channel["id"]))["status"] == "upgrade"


# ── Activity log ──────────────────────────────────────────────────────
async def _catalog_log(arr_app, cid) -> list[dict]:
    """The channel's Catalog events on the Activity page, newest first."""
    rows = (await arr_app.http.get("/api/logs", params={"channel_id": cid})).raise_for_status().json()
    return [r["msg"] for r in rows if r["msg"] and r["msg"]["key"].startswith("event.catalog_")]


@pytest.mark.asyncio
async def test_each_download_is_logged_for_the_activity_page(arr_app, arrs, films):
    _radarr_with_choices(arrs)
    channel = await _channel_offering_theory(arr_app)

    (await _download(arr_app, channel["id"])).raise_for_status()
    (await _download(arr_app, channel["id"])).raise_for_status()

    assert await _catalog_log(arr_app, channel["id"]) == [
        {"key": "event.catalog_searched", "params": {"title": "La teoria del tot"}},
        {"key": "event.catalog_added", "params": {"title": "La teoria del tot"}}]


@pytest.mark.asyncio
async def test_a_refused_download_is_logged_with_radarrs_reason(arr_app, arrs, films):
    _radarr_with_choices(arrs)
    arrs.radarr.reject_movie = "Path '/movies4k' is not writable"
    channel = await _channel_offering_theory(arr_app)

    assert (await _download(arr_app, channel["id"])).status_code == 502

    [logged] = await _catalog_log(arr_app, channel["id"])
    assert logged["key"] == "event.catalog_download_failed"
    assert logged["params"]["title"] == "La teoria del tot"
    assert "is not writable" in logged["params"]["error"]


@pytest.mark.asyncio
async def test_a_radarr_server_error_is_a_keyed_http_error_and_saves_no_marker(arr_app, arrs, films):
    _radarr_with_choices(arrs)
    channel = await _channel_offering_theory(arr_app)
    arrs.radarr.fail_status = 503

    r = await _download(arr_app, channel["id"])

    assert r.status_code == 502
    assert r.json()["detail"]["key"] == "err.arr.http"
    assert r.json()["detail"]["params"]["status"] == 503
    arrs.radarr.fail_status = None                                                    # Radarr back
    assert await _status_of_theory(arr_app, channel["id"]) == {"tmdb_id": THEORY_TMDB, "status": "missing"}


@pytest.mark.asyncio
async def test_radarr_without_a_profile_or_root_folder_is_a_keyed_error_and_adds_nothing(arr_app, arrs, films):
    arrs.radarr.root_folders = [{"id": 1, "path": "/movies", "freeSpace": 1}]          # no quality profile
    channel = await _channel_offering_theory(arr_app)

    r = await _download(arr_app, channel["id"])

    assert r.status_code == 502
    assert r.json()["detail"] == {"key": "err.radarr.no_defaults", "params": {}}
    assert arrs.radarr.added_movies() == []
    assert await _status_of_theory(arr_app, channel["id"]) == {"tmdb_id": THEORY_TMDB, "status": "missing"}


@pytest.mark.asyncio
async def test_a_radarr_rejection_returns_its_reason_and_saves_no_marker(arr_app, arrs, films):
    _radarr_with_choices(arrs)
    arrs.radarr.reject_movie = "Path '/movies4k' is not writable"
    channel = await _channel_offering_theory(arr_app)

    r = await _download(arr_app, channel["id"])

    assert r.status_code == 502
    detail = r.json()["detail"]
    assert detail["key"] == "err.arr.http"
    assert detail["params"]["status"] == 400
    assert "Path '/movies4k' is not writable" in detail["params"]["detail"]
    assert arrs.radarr.movies == []
    assert await _status_of_theory(arr_app, channel["id"]) == {"tmdb_id": THEORY_TMDB, "status": "missing"}


@pytest.mark.asyncio
@pytest.mark.parametrize("radarr, key", [
    ({"radarr_url": "http://nowhere.test:7878", "radarr_key": RADARR_KEY}, "err.arr.unreachable"),
    ({**RADARR, "radarr_key": "wrong-key"}, "err.arr.bad_key"),
    ({}, "err.arr.not_set"),
], ids=["unreachable", "bad-key", "not-configured"])
async def test_radarr_failing_is_a_keyed_error_with_no_marker(arr_app, arrs, films, radarr, key):
    _radarr_with_choices(arrs)
    channel = await _channel_offering_theory(arr_app, radarr=radarr)

    r = await _download(arr_app, channel["id"])

    assert r.status_code == 502
    assert r.json()["detail"]["key"] == key
    (await arr_app.http.patch("/api/settings", json=RADARR)).raise_for_status()      # Radarr back
    assert await _status_of_theory(arr_app, channel["id"]) == {"tmdb_id": THEORY_TMDB, "status": "missing"}


@pytest.mark.asyncio
async def test_a_film_not_in_the_channels_catalog_is_refused_without_asking_radarr(arr_app, arrs, films):
    _radarr_with_choices(arrs)
    channel = await _channel_offering_theory(arr_app)

    r = await _download(arr_app, channel["id"], tmdb_id=50797)

    assert r.status_code == 404
    assert r.json()["detail"] == {"key": "err.catalog.not_in_catalog", "params": {"tmdb_id": 50797}}
    assert arrs.radarr.requests == []


@pytest.mark.asyncio
async def test_downloading_from_a_series_channel_is_refused(arr_app, arrs):
    arr_app.telegram.add_channel(MOVIE_CHAT, "Sèries")
    series = await arr_app.add_channel(MOVIE_CHAT, kind="tv")

    r = await _download(arr_app, series["id"])

    assert r.status_code == 400
    assert r.json()["detail"] == {"key": "err.catalog.not_movie_channel", "params": {}}
    assert arrs.radarr.requests == []


@pytest.mark.asyncio
async def test_downloading_from_an_unknown_channel_is_refused(arr_app, arrs):
    r = await _download(arr_app, 999)

    assert r.status_code == 404
    assert r.json()["detail"] == {"key": "err.catalog.unknown_channel", "params": {"id": 999}}


@pytest.mark.asyncio
async def test_downloading_needs_a_signed_in_user(arr_app, arrs):
    arr_app.http.cookies.clear()

    r = await _download(arr_app, 1)

    assert r.status_code == 401
    assert arrs.radarr.requests == []
