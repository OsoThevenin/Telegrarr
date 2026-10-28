"""Catalog search, status filters with per-filter counts, and paging.

``GET /api/channels/{cid}/catalog`` takes ``q`` (title search, accents and case
ignored), ``filter`` (all | missing | downloaded | upgrade) and ``offset``/``limit``.
Driven over HTTP (``arr_app``) against the fake Radarr (``arrs``) and fake TMDB.
"""
import pytest

from fake_arr import RADARR_KEY, radarr_movie
from fake_tmdb import API_KEY

MOVIE_CHAT = -1003333333333
THEORY_TMDB, PA_NEGRE_TMDB, ALCARRAS_TMDB, ESTIU_TMDB = 266856, 50797, 822119, 419704
RADARR = {"radarr_url": "http://radarr.test:7878", "radarr_key": RADARR_KEY}
NO_RADARR = {"radarr_url": "http://nowhere.test", "radarr_key": RADARR_KEY}
MOVIE_LIST = "/api/v3/movie"

THEORY = ("La teoria del tot (2014)", "La.teoria.del.tot.2014.1080p.mkv")
PA_NEGRE = ("Pa negre (2010)", "Pa_negre_2010_720p.mkv")
ALCARRAS = ("Alcarràs (2022)", "Alcarras.2022.1080p.mkv")
ESTIU = ("Estiu 1993 (2017)", "Estiu.1993.2017.1080p.mkv")
UNIDENTIFIED = ("", "La.casa.del.llac.CAT.1080p.mkv")


@pytest.fixture()
def films(fake_tmdb):
    fake_tmdb.add_movie(THEORY_TMDB, titles={"ca-ES": "La teoria del tot", "en-US": "The Theory of Everything"},
                        release_date="2014-11-07", imdb_id="tt2980516")
    fake_tmdb.add_movie(PA_NEGRE_TMDB, titles={"ca-ES": "Pa negre", "en-US": "Black Bread"},
                        original_title="Pa negre", release_date="2010-10-15", imdb_id="tt1302067")
    fake_tmdb.add_movie(ALCARRAS_TMDB, titles={"ca-ES": "Alcarràs", "en-US": "Alcarràs"},
                        release_date="2022-04-29", imdb_id="tt12588448")
    fake_tmdb.add_movie(ESTIU_TMDB, titles={"ca-ES": "Estiu 1993", "en-US": "Summer 1993"},
                        original_title="Estiu 1993", release_date="2017-06-30", imdb_id="tt5897002")
    return fake_tmdb


async def _channel_offering(arr_app, *posts, radarr: dict | None = None) -> dict:
    """A movie channel whose posts (text, file name), oldest first, are indexed."""
    (await arr_app.http.patch("/api/settings", json={"tmdb_key": API_KEY, **(RADARR if radarr is None else radarr)})
     ).raise_for_status()
    arr_app.telegram.add_channel(MOVIE_CHAT, "Pel·lícules en català")
    channel = await arr_app.add_channel(MOVIE_CHAT, kind="movie")
    for text, file_name in posts:
        arr_app.telegram.post(MOVIE_CHAT, text=text, file_name=file_name)
    await arr_app.scan(channel["id"])
    return channel


async def _catalog(arr_app, cid, **params) -> dict:
    r = await arr_app.http.get(f"/api/channels/{cid}/catalog", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def _titles(catalog: dict) -> list[str]:
    return [row["title"] for row in catalog["rows"]]


# ── search ────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_search_ignores_accents_and_case(arr_app, arrs, films):
    channel = await _channel_offering(arr_app, THEORY, ALCARRAS, PA_NEGRE)

    catalog = await _catalog(arr_app, channel["id"], q="ALCARRAS")

    assert _titles(catalog) == ["Alcarràs"]
    assert catalog["count"] == 1


@pytest.mark.asyncio
async def test_search_matches_every_word_of_the_query_anywhere_in_the_title(arr_app, arrs, films):
    channel = await _channel_offering(arr_app, THEORY, PA_NEGRE)

    catalog = await _catalog(arr_app, channel["id"], q="tot teoria")

    assert _titles(catalog) == ["La teoria del tot"]


@pytest.mark.asyncio
async def test_search_finds_an_unidentified_message_by_its_file_name(arr_app, arrs, films):
    channel = await _channel_offering(arr_app, THEORY, UNIDENTIFIED)

    catalog = await _catalog(arr_app, channel["id"], q="casa llac")

    assert [row["kind"] for row in catalog["rows"]] == ["unidentified"]


@pytest.mark.asyncio
async def test_a_search_with_no_match_has_no_rows_but_keeps_the_channel_total(arr_app, arrs, films):
    channel = await _channel_offering(arr_app, THEORY, PA_NEGRE)

    catalog = await _catalog(arr_app, channel["id"], q="Interstellar")

    assert (catalog["rows"], catalog["count"], catalog["counts"]["all"]) == ([], 0, 2)


# ── the plain list ────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_the_unfiltered_list_never_asks_radarr_and_counts_only_all(arr_app, arrs, films):
    channel = await _channel_offering(arr_app, THEORY, PA_NEGRE, UNIDENTIFIED)

    catalog = await _catalog(arr_app, channel["id"], q="pa")

    assert arrs.radarr.requests == []
    assert catalog["counts"] == {"all": 3, "missing": None, "downloaded": None, "upgrade": None}


# ── status filters and counts ─────────────────────────────────────────
@pytest.fixture()
def radarr_has(arrs):
    """Radarr: Pa negre requested (no file), Alcarràs at 1080p (the channel's best), Estiu 1993 at 720p."""
    arrs.radarr.movies = [radarr_movie(1, PA_NEGRE_TMDB), radarr_movie(2, ALCARRAS_TMDB, resolution=1080),
                          radarr_movie(3, ESTIU_TMDB, resolution=720)]
    return arrs


async def _four_films(arr_app) -> dict:
    """Four films plus one unidentified message, posted in this order (so listed in reverse)."""
    return await _channel_offering(arr_app, THEORY, PA_NEGRE, ALCARRAS, ESTIU, UNIDENTIFIED)


@pytest.mark.asyncio
async def test_the_missing_filter_keeps_only_films_radarr_does_not_have(arr_app, radarr_has, films):
    channel = await _four_films(arr_app)

    catalog = await _catalog(arr_app, channel["id"], filter="missing")

    assert [(r["tmdb_id"], r["status"]) for r in catalog["rows"]] == [(THEORY_TMDB, "missing")]
    assert catalog["count"] == 1


@pytest.mark.asyncio
async def test_the_downloaded_filter_keeps_downloads_including_ones_with_an_upgrade(arr_app, radarr_has, films):
    channel = await _four_films(arr_app)

    catalog = await _catalog(arr_app, channel["id"], filter="downloaded")

    assert [(r["tmdb_id"], r["status"]) for r in catalog["rows"]] == [(ESTIU_TMDB, "upgrade"),
                                                                      (ALCARRAS_TMDB, "downloaded")]


@pytest.mark.asyncio
async def test_the_upgrade_filter_keeps_only_quality_upgrades(arr_app, radarr_has, films):
    channel = await _four_films(arr_app)

    [row] = (await _catalog(arr_app, channel["id"], filter="upgrade"))["rows"]

    assert (row["tmdb_id"], row["radarr_quality"], row["best_quality"]) == (ESTIU_TMDB, "720p", "1080p")


@pytest.mark.asyncio
async def test_a_filtered_page_counts_every_filter_over_the_whole_channel(arr_app, radarr_has, films):
    channel = await _four_films(arr_app)

    catalog = await _catalog(arr_app, channel["id"], filter="missing", q="teoria", limit=1)

    assert catalog["counts"] == {"all": 5, "missing": 1, "downloaded": 2, "upgrade": 1}


@pytest.mark.asyncio
async def test_a_filtered_page_reads_radarrs_movie_list_once(arr_app, radarr_has, films):
    channel = await _four_films(arr_app)

    await _catalog(arr_app, channel["id"], filter="downloaded")

    assert [r.url.path for r in radarr_has.radarr.requests] == [MOVIE_LIST]


@pytest.mark.asyncio
async def test_search_and_filter_combine(arr_app, radarr_has, films):
    channel = await _four_films(arr_app)

    catalog = await _catalog(arr_app, channel["id"], filter="downloaded", q="alcarras")

    assert _titles(catalog) == ["Alcarràs"]


@pytest.mark.asyncio
async def test_the_status_response_carries_the_same_counts(arr_app, radarr_has, films):
    channel = await _four_films(arr_app)

    r = await arr_app.http.get(f"/api/channels/{channel['id']}/catalog/status")

    assert r.json()["counts"] == {"all": 5, "missing": 1, "downloaded": 2, "upgrade": 1}


@pytest.mark.asyncio
async def test_a_download_moves_the_film_out_of_the_missing_count(arr_app, radarr_has, films):
    radarr_has.radarr.quality_profiles = [{"id": 4, "name": "HD-1080p"}]
    radarr_has.radarr.root_folders = [{"id": 1, "path": "/movies", "freeSpace": 1}]
    channel = await _four_films(arr_app)

    (await arr_app.http.post(f"/api/channels/{channel['id']}/catalog/{THEORY_TMDB}/download")).raise_for_status()
    # Radarr doesn't list the film yet: only the local marker keeps it out of Falten
    radarr_has.radarr.movies = [m for m in radarr_has.radarr.movies if m["tmdbId"] != THEORY_TMDB]
    catalog = await _catalog(arr_app, channel["id"], filter="missing")

    assert catalog["rows"] == []
    assert catalog["counts"] == {"all": 5, "missing": 0, "downloaded": 2, "upgrade": 1}


@pytest.mark.asyncio
async def test_an_unknown_filter_is_a_keyed_error(arr_app, arrs, films):
    channel = await _channel_offering(arr_app, THEORY)

    r = await arr_app.http.get(f"/api/channels/{channel['id']}/catalog", params={"filter": "seen"})

    assert r.status_code == 400
    assert r.json()["detail"] == {"key": "err.catalog.unknown_filter", "params": {"filter": "seen"}}


# ── offline ───────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_without_radarr_a_filtered_request_is_a_keyed_error(arr_app, arrs, films):
    channel = await _channel_offering(arr_app, THEORY, radarr=NO_RADARR)

    r = await arr_app.http.get(f"/api/channels/{channel['id']}/catalog", params={"filter": "missing"})

    assert r.status_code == 502
    assert r.json()["detail"] == {"key": "err.catalog.filter_needs_radarr", "params": {}}


@pytest.mark.asyncio
async def test_without_radarr_the_unfiltered_list_is_still_served(arr_app, arrs, films):
    channel = await _channel_offering(arr_app, THEORY, PA_NEGRE, radarr=NO_RADARR)

    catalog = await _catalog(arr_app, channel["id"], q="negre")

    assert _titles(catalog) == ["Pa negre"]


# ── paging ────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_pages_follow_each_other_newest_first_with_no_repeats_or_gaps(arr_app, arrs, films):
    channel = await _four_films(arr_app)
    whole = await _catalog(arr_app, channel["id"])

    first = await _catalog(arr_app, channel["id"], limit=2)
    second = await _catalog(arr_app, channel["id"], limit=2, offset=first["next_offset"])
    last = await _catalog(arr_app, channel["id"], limit=2, offset=second["next_offset"])

    assert _titles(whole) == ["La.casa.del.llac.CAT.1080p.mkv", "Estiu 1993", "Alcarràs", "Pa negre",
                              "La teoria del tot"]
    assert _titles(first) + _titles(second) + _titles(last) == _titles(whole)
    assert (first["next_offset"], second["next_offset"], last["next_offset"]) == (2, 4, None)
    assert {first["count"], second["count"], last["count"]} == {5}


@pytest.mark.asyncio
async def test_a_filtered_page_has_a_next_offset_over_its_matches(arr_app, radarr_has, films):
    channel = await _four_films(arr_app)

    first = await _catalog(arr_app, channel["id"], filter="downloaded", limit=1)

    assert (_titles(first), first["count"], first["next_offset"]) == (["Estiu 1993"], 2, 1)


@pytest.mark.asyncio
async def test_without_paging_parameters_the_first_page_has_the_default_size(arr_app, arrs, films):
    channel = await _channel_offering(arr_app, THEORY)

    catalog = await _catalog(arr_app, channel["id"])

    assert (catalog["offset"], catalog["limit"], catalog["next_offset"]) == (0, 50, None)


@pytest.mark.asyncio
async def test_a_negative_offset_is_refused(arr_app, arrs, films):
    channel = await _channel_offering(arr_app, THEORY)

    r = await arr_app.http.get(f"/api/channels/{channel['id']}/catalog", params={"offset": -1})

    assert r.status_code == 400
