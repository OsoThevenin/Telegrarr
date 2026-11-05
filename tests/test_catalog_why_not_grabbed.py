"""“Why not grabbed?”: Radarr's verdict on Telegrarr's releases of a Catalog film.

The operator asks for it; Telegrarr runs Radarr's interactive release search for the
film and passes Radarr's decisions through verbatim. Driven over HTTP (``arr_app``)
against the fake Radarr (``arrs``), asserting the answers and the searches it saw.
"""
import asyncio
from collections import defaultdict

import pytest

from app import catalog_why
from fake_arr import RADARR_KEY, radarr_movie, radarr_queue_item, radarr_release
from fake_tmdb import API_KEY

MOVIE_CHAT = -1005555555555
THEORY_TMDB, THEORY_IMDB = 266856, "tt2980516"
RADARR_ID = 12
RADARR = {"radarr_url": "http://radarr.test:7878", "radarr_key": RADARR_KEY}
THEORY_RELEASE = "La.teoria.del.tot.2014.CAT.1080p.WEB-DL"
CUTOFF = "Existing file meets cutoff: Bluray-1080p"
LANGUAGE = "Language is not wanted in profile"
IN_QUEUE = "Release in queue is of equal or higher preference: WEBDL-1080p"
TOO_NEW = "Only 12.5 minutes old, minimum age is 60 minutes"


@pytest.fixture(autouse=True)
def empty_answer_cache(monkeypatch):
    """The cache lives for the process; each test starts without one."""
    monkeypatch.setattr(catalog_why, "_answers", {})
    monkeypatch.setattr(catalog_why, "_searches", defaultdict(asyncio.Lock))


@pytest.fixture()
def films(fake_tmdb):
    fake_tmdb.add_movie(THEORY_TMDB, titles={"ca-ES": "La teoria del tot", "en-US": "The Theory of Everything"},
                        release_date="2014-11-07", imdb_id=THEORY_IMDB)
    return fake_tmdb


async def _channel_offering_theory(arr_app, radarr: dict | None = None) -> dict:
    (await arr_app.http.patch("/api/settings", json={"tmdb_key": API_KEY, **(RADARR if radarr is None else radarr)})
     ).raise_for_status()
    arr_app.telegram.add_channel(MOVIE_CHAT, "Pel·lícules en català")
    channel = await arr_app.add_channel(MOVIE_CHAT, kind="movie")
    arr_app.telegram.post(MOVIE_CHAT, text="La teoria del tot (2014)", file_name="La.teoria.del.tot.2014.1080p.mkv")
    await arr_app.scan(channel["id"])
    return channel


def _in_radarr(arrs, *releases) -> None:
    arrs.radarr.movies = [radarr_movie(RADARR_ID, THEORY_TMDB, resolution=720)]
    arrs.radarr.releases = {RADARR_ID: list(releases)}


def _why(arr_app, cid, tmdb_id=THEORY_TMDB):
    return arr_app.http.post(f"/api/channels/{cid}/catalog/{tmdb_id}/why-not-grabbed")


@pytest.mark.asyncio
async def test_only_telegrarrs_releases_come_back_with_radarrs_rejections_verbatim(arr_app, arrs, films):
    _in_radarr(arrs,
               radarr_release("Theory.2014.1080p.BluRay", indexer="NZBgeek", guid="geek-1", rejections=(CUTOFF,)),
               radarr_release(THEORY_RELEASE, rejections=(CUTOFF, LANGUAGE)))
    channel = await _channel_offering_theory(arr_app)

    r = await _why(arr_app, channel["id"])

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["tmdb_id"] == THEORY_TMDB
    assert body["releases"] == [{"title": THEORY_RELEASE, "approved": False, "rejections": [CUTOFF, LANGUAGE]}]
    assert body["verdict"] == "rejected"
    assert body["message"]["key"] == "cat.why.rejected"
    assert arrs.radarr.release_searches() == [RADARR_ID]


@pytest.mark.asyncio
@pytest.mark.parametrize("indexer, guid", [
    ("Telegrarr (Prowlarr)", "telearr-1-1"),     # how Prowlarr names what it syncs to Radarr
    ("telegrarr", "https://prowlarr.test/1"),    # the operator's own casing, guid rewritten
    ("Catalan films", "telearr--1005-9"),        # the operator's own name: the guid is ours
])
async def test_telegrarrs_releases_are_recognised_however_radarr_names_the_indexer(arr_app, arrs, films, indexer, guid):
    _in_radarr(arrs, radarr_release(THEORY_RELEASE, indexer=indexer, guid=guid, rejections=(CUTOFF,)))
    channel = await _channel_offering_theory(arr_app)

    r = await _why(arr_app, channel["id"])

    assert [rel["title"] for rel in r.json()["releases"]] == [THEORY_RELEASE]


@pytest.mark.asyncio
async def test_an_approved_release_answers_that_radarr_would_accept_it(arr_app, arrs, films):
    _in_radarr(arrs, radarr_release(THEORY_RELEASE),
               radarr_release("La.teoria.del.tot.2014.CAT.720p", guid="telearr-1-2", rejections=(CUTOFF,)))
    channel = await _channel_offering_theory(arr_app)

    body = (await _why(arr_app, channel["id"])).json()

    assert body["verdict"] == "would_accept"
    assert body["message"]["key"] == "cat.why.would_accept"
    assert {"title": THEORY_RELEASE, "approved": True, "rejections": []} in body["releases"]


@pytest.mark.asyncio
async def test_a_film_already_in_radarrs_queue_answers_that_radarr_would_accept_it(arr_app, arrs, films):
    _in_radarr(arrs, radarr_release(THEORY_RELEASE, rejections=(IN_QUEUE,)))
    arrs.radarr.queue = [radarr_queue_item(RADARR_ID)]
    channel = await _channel_offering_theory(arr_app)

    body = (await _why(arr_app, channel["id"])).json()

    assert body["verdict"] == "would_accept"
    assert body["message"]["key"] == "cat.why.would_accept"
    assert body["releases"] == [{"title": THEORY_RELEASE, "approved": False, "rejections": [IN_QUEUE]}]


@pytest.mark.asyncio
async def test_a_temporarily_rejected_release_answers_that_radarr_would_accept_it(arr_app, arrs, films):
    _in_radarr(arrs, radarr_release(THEORY_RELEASE, rejections=(TOO_NEW,), temporary=True))
    channel = await _channel_offering_theory(arr_app)

    body = (await _why(arr_app, channel["id"])).json()

    assert body["verdict"] == "would_accept"
    assert body["releases"] == [{"title": THEORY_RELEASE, "approved": False, "rejections": [TOO_NEW]}]


@pytest.mark.asyncio
async def test_a_failed_download_radarr_is_replacing_does_not_count_as_queued(arr_app, arrs, films):
    _in_radarr(arrs, radarr_release(THEORY_RELEASE, rejections=(CUTOFF,)))
    arrs.radarr.queue = [radarr_queue_item(RADARR_ID, state="failedPending")]
    channel = await _channel_offering_theory(arr_app)

    body = (await _why(arr_app, channel["id"])).json()

    assert body["verdict"] == "rejected"


@pytest.mark.asyncio
async def test_another_films_download_does_not_count_as_queued(arr_app, arrs, films):
    _in_radarr(arrs, radarr_release(THEORY_RELEASE, rejections=(CUTOFF,)))
    arrs.radarr.queue = [radarr_queue_item(RADARR_ID + 1)]
    channel = await _channel_offering_theory(arr_app)

    body = (await _why(arr_app, channel["id"])).json()

    assert body["verdict"] == "rejected"


@pytest.mark.asyncio
async def test_no_release_from_telegrarr_says_so(arr_app, arrs, films):
    _in_radarr(arrs, radarr_release("Theory.2014.1080p", indexer="NZBgeek", guid="geek-1"))
    channel = await _channel_offering_theory(arr_app)

    body = (await _why(arr_app, channel["id"])).json()

    assert body["verdict"] == "no_releases"
    assert body["message"]["key"] == "cat.why.no_releases"
    assert body["releases"] == []


@pytest.mark.asyncio
async def test_a_second_request_within_ten_minutes_is_served_from_cache(arr_app, arrs, films, monkeypatch):
    _in_radarr(arrs, radarr_release(THEORY_RELEASE, rejections=(CUTOFF,)))
    channel = await _channel_offering_theory(arr_app)
    first = await _why(arr_app, channel["id"])
    arrs.radarr.releases = {RADARR_ID: []}          # a new search would answer differently
    real = catalog_why.time.monotonic
    monkeypatch.setattr(catalog_why.time, "monotonic", lambda: real() + 9 * 60)

    second = await _why(arr_app, channel["id"])

    assert second.json() == first.json()
    assert arrs.radarr.release_searches() == [RADARR_ID]


@pytest.mark.asyncio
async def test_after_ten_minutes_the_film_is_searched_again(arr_app, arrs, films, monkeypatch):
    _in_radarr(arrs, radarr_release(THEORY_RELEASE, rejections=(CUTOFF,)))
    channel = await _channel_offering_theory(arr_app)
    await _why(arr_app, channel["id"])
    arrs.radarr.releases = {RADARR_ID: [radarr_release(THEORY_RELEASE)]}
    real = catalog_why.time.monotonic
    monkeypatch.setattr(catalog_why.time, "monotonic", lambda: real() + 10 * 60 + 1)

    body = (await _why(arr_app, channel["id"])).json()

    assert body["verdict"] == "would_accept"
    assert arrs.radarr.release_searches() == [RADARR_ID, RADARR_ID]


@pytest.mark.asyncio
async def test_a_second_click_while_the_search_runs_waits_for_it_instead_of_searching_again(arr_app, arrs, films):
    _in_radarr(arrs, radarr_release(THEORY_RELEASE, rejections=(CUTOFF,)))
    channel = await _channel_offering_theory(arr_app)

    answers = await asyncio.gather(_why(arr_app, channel["id"]), _why(arr_app, channel["id"]))

    assert [a.status_code for a in answers] == [200, 200]
    assert answers[0].json() == answers[1].json()
    assert arrs.radarr.release_searches() == [RADARR_ID]


@pytest.mark.asyncio
async def test_a_failed_search_is_not_cached(arr_app, arrs, films):
    _in_radarr(arrs, radarr_release(THEORY_RELEASE, rejections=(CUTOFF,)))
    channel = await _channel_offering_theory(arr_app)
    arrs.radarr.fail_status = 500

    failed = await _why(arr_app, channel["id"])
    arrs.radarr.fail_status = None
    recovered = await _why(arr_app, channel["id"])

    assert failed.status_code == 502
    assert failed.json()["detail"]["key"] == "err.arr.http"
    assert recovered.status_code == 200
    assert recovered.json()["verdict"] == "rejected"


@pytest.mark.asyncio
async def test_radarr_unreachable_is_a_keyed_error(arr_app, arrs, films):
    down = {"radarr_url": "http://radarr-down.test:7878", "radarr_key": RADARR_KEY}
    channel = await _channel_offering_theory(arr_app, radarr=down)

    r = await _why(arr_app, channel["id"])

    assert r.status_code == 502
    assert r.json()["detail"]["key"] == "err.arr.unreachable"


@pytest.mark.asyncio
async def test_radarr_not_configured_is_a_keyed_error(arr_app, arrs, films):
    channel = await _channel_offering_theory(arr_app, radarr={})

    r = await _why(arr_app, channel["id"])

    assert r.status_code == 502
    assert r.json()["detail"]["key"] == "err.arr.not_set"


@pytest.mark.asyncio
async def test_a_film_radarr_lacks_is_a_keyed_error_and_runs_no_search(arr_app, arrs, films):
    channel = await _channel_offering_theory(arr_app)

    r = await _why(arr_app, channel["id"])

    assert r.status_code == 404
    assert r.json()["detail"] == {"key": "err.catalog.not_in_radarr", "params": {"tmdb_id": THEORY_TMDB}}
    assert arrs.radarr.release_searches() == []


@pytest.mark.asyncio
async def test_a_film_the_catalog_does_not_offer_is_refused_without_asking_radarr(arr_app, arrs, films):
    _in_radarr(arrs)
    channel = await _channel_offering_theory(arr_app)
    before = len(arrs.radarr.requests)

    r = await _why(arr_app, channel["id"], tmdb_id=999)

    assert r.status_code == 404
    assert r.json()["detail"]["key"] == "err.catalog.not_in_catalog"
    assert len(arrs.radarr.requests) == before


@pytest.mark.asyncio
async def test_a_malformed_search_answer_is_a_keyed_error(arr_app, arrs, films):
    _in_radarr(arrs)
    arrs.radarr.releases = {RADARR_ID: {"not": "a list"}}
    channel = await _channel_offering_theory(arr_app)

    r = await _why(arr_app, channel["id"])

    assert r.status_code == 502
    assert r.json()["detail"]["key"] == "err.arr.bad_shape"


@pytest.mark.asyncio
async def test_a_malformed_queue_answer_is_a_keyed_error(arr_app, arrs, films):
    _in_radarr(arrs, radarr_release(THEORY_RELEASE))
    arrs.radarr.queue = "not a queue"
    channel = await _channel_offering_theory(arr_app)

    r = await _why(arr_app, channel["id"])

    assert r.status_code == 502
    assert r.json()["detail"]["key"] == "err.arr.bad_shape"


@pytest.mark.asyncio
async def test_a_search_slower_than_ordinary_radarr_calls_still_answers(arr_app, arrs, films):
    _in_radarr(arrs, radarr_release(THEORY_RELEASE, rejections=(CUTOFF,)))
    arrs.radarr.release_search_s = 60.0             # Radarr waits on every indexer it has
    channel = await _channel_offering_theory(arr_app)

    r = await _why(arr_app, channel["id"])

    assert r.status_code == 200, r.text


@pytest.mark.asyncio
async def test_no_radarr_search_runs_unless_the_operator_asks(arr_app, arrs, films):
    _in_radarr(arrs, radarr_release(THEORY_RELEASE, rejections=(CUTOFF,)))
    channel = await _channel_offering_theory(arr_app)
    await arr_app.http.get(f"/api/channels/{channel['id']}/catalog")
    await arr_app.http.get(f"/api/channels/{channel['id']}/catalog/status")
    await arr_app.http.post(f"/api/channels/{channel['id']}/catalog/{THEORY_TMDB}/download")
    await arr_app.scan(channel["id"])

    assert arrs.radarr.release_searches() == []


@pytest.mark.asyncio
async def test_asking_needs_a_login(arr_app, arrs, films):
    _in_radarr(arrs)
    channel = await _channel_offering_theory(arr_app)
    arr_app.http.cookies.clear()

    r = await _why(arr_app, channel["id"])

    assert r.status_code == 401
    assert arrs.radarr.release_searches() == []


@pytest.mark.asyncio
async def test_asking_reads_nothing_from_telegram(arr_app, arrs, films):
    _in_radarr(arrs, radarr_release(THEORY_RELEASE, rejections=(CUTOFF,)))
    channel = await _channel_offering_theory(arr_app)
    reads = list(arr_app.telegram.history_reads)

    await _why(arr_app, channel["id"])

    assert arr_app.telegram.history_reads == reads
