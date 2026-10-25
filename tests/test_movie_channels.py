"""Movie channels: each posted film is matched on TMDB and offered to Radarr by id;
messages without a confident match wait in the Pending review queue.

Driven over HTTP (``arr_app``) with TMDB faked at the httpx transport level
(``fake_tmdb``) and Telegram faked by the harness.
"""
import xml.etree.ElementTree as ET

import pytest

from fake_tmdb import API_KEY
from http_harness import eventually

NEWZNAB_NS = "{http://www.newznab.com/DTD/2010/feeds/attributes/}"
MOVIE_CHAT = -1003333333333
THEORY_TMDB, THEORY_IMDB = 266856, "tt2980516"
PA_NEGRE_TMDB, PA_NEGRE_IMDB = 50797, "tt1302067"


@pytest.fixture()
def films(fake_tmdb):
    fake_tmdb.add_movie(THEORY_TMDB, titles={"ca-ES": "La teoria del tot", "en-US": "The Theory of Everything"},
                        release_date="2014-11-07", imdb_id=THEORY_IMDB)
    fake_tmdb.add_movie(PA_NEGRE_TMDB, titles={"ca-ES": "Pa negre", "en-US": "Black Bread"},
                        original_title="Pa negre", release_date="2010-10-15", imdb_id=PA_NEGRE_IMDB)
    return fake_tmdb


async def _movie_channel(arr_app):
    (await arr_app.http.patch("/api/settings", json={"tmdb_key": API_KEY})).raise_for_status()
    arr_app.telegram.add_channel(MOVIE_CHAT, "Pel·lícules en català")
    return await arr_app.add_channel(MOVIE_CHAT, kind="movie")


async def _movie_search(arr_app, **params) -> list[ET.Element]:
    r = await arr_app.http.get("/api/newznab", params={"t": "movie", "apikey": arr_app.apikey, **params})
    assert r.status_code == 200
    return ET.fromstring(r.text).findall("./channel/item")


def _attrs(item: ET.Element) -> dict[str, str]:
    return {a.attrib["name"]: a.attrib["value"] for a in item.findall(f"{NEWZNAB_NS}attr")}


@pytest.mark.asyncio
@pytest.mark.parametrize("id_param", [
    {"tmdbid": str(THEORY_TMDB)},
    {"imdbid": THEORY_IMDB.removeprefix("tt")},
    {"imdbid": THEORY_IMDB},
])
async def test_a_confidently_matched_film_is_found_by_radarr_id_search(arr_app, films, id_param):
    channel = await _movie_channel(arr_app)
    arr_app.telegram.post(MOVIE_CHAT, text="La teoria del tot (2014)", file_name="La.teoria.del.tot.2014.1080p.mkv")
    arr_app.telegram.post(MOVIE_CHAT, text="Pa negre (2010)", file_name="Pa_negre_2010_720p.mkv")
    await arr_app.scan(channel["id"])

    items = await _movie_search(arr_app, **id_param)

    assert [i.find("title").text for i in items] == ["The.Theory.of.Everything.2014.CAT.1080p.WEB-DL.x264-TELEGRARR"]
    attrs = _attrs(items[0])
    assert (attrs["tmdbid"], attrs["imdb"]) == (str(THEORY_TMDB), THEORY_IMDB.removeprefix("tt"))


@pytest.mark.asyncio
async def test_film_lookup_searches_tmdb_in_catalan_with_the_year(arr_app, films):
    channel = await _movie_channel(arr_app)
    arr_app.telegram.post(MOVIE_CHAT, text="", file_name="Pa_negre_2010_720p.mkv")

    await arr_app.scan(channel["id"])

    assert films.movie_searches()[0] == ("Pa negre", "ca-ES", "2010")
    assert [i.find("title").text for i in await _movie_search(arr_app, tmdbid=str(PA_NEGRE_TMDB))] == [
        "Black.Bread.2010.CAT.720p.WEB-DL.x264-TELEGRARR"]


async def _review(arr_app) -> list[dict]:
    r = await arr_app.http.get("/api/review")
    assert r.status_code == 200
    return r.json()


@pytest.mark.asyncio
@pytest.mark.parametrize("text, file_name, reason", [
    ("La teoria del tot", "La.teoria.del.tot.1080p.mkv", "No year"),           # no year → no lookup
    ("La teoria del tot (1999)", "film.mkv", "No confident TMDB match"),       # wrong year
    ("Una pel·lícula que no existeix (2014)", "x.mkv", "No confident TMDB match"),
])
async def test_an_unmatched_film_waits_in_pending_review_and_is_not_offered(arr_app, films, text, file_name,
                                                                             reason):
    channel = await _movie_channel(arr_app)
    msg = arr_app.telegram.post(MOVIE_CHAT, text=text, file_name=file_name)

    await arr_app.scan(channel["id"])

    assert await _movie_search(arr_app) == []
    [entry] = await _review(arr_app)
    assert (entry["channel_id"], entry["message_id"]) == (channel["id"], msg.id)
    assert entry["channel_title"] == "Pel·lícules en català"
    assert entry["file_name"] == file_name
    assert reason in entry["reason"]


@pytest.mark.asyncio
async def test_without_a_year_tmdb_is_not_even_asked(arr_app, films):
    channel = await _movie_channel(arr_app)
    arr_app.telegram.post(MOVIE_CHAT, text="La teoria del tot", file_name="La.teoria.del.tot.mkv")

    await arr_app.scan(channel["id"])

    assert films.movie_searches() == []


@pytest.mark.asyncio
async def test_without_a_tmdb_key_films_wait_for_review(arr_app, films):
    arr_app.telegram.add_channel(MOVIE_CHAT, "Pel·lícules en català")
    channel = await arr_app.add_channel(MOVIE_CHAT, kind="movie")
    arr_app.telegram.post(MOVIE_CHAT, text="La teoria del tot (2014)", file_name="x.mkv")

    await arr_app.scan(channel["id"])

    [entry] = await _review(arr_app)
    assert "TMDB API key is required" in entry["reason"]
    assert await _movie_search(arr_app) == []


async def _one_pending(arr_app, text="La teoria del tot", file_name="La.teoria.del.tot.1080p.mkv"):
    channel = await _movie_channel(arr_app)
    msg = arr_app.telegram.post(MOVIE_CHAT, text=text, file_name=file_name)
    await arr_app.scan(channel["id"])
    return channel, msg


async def _backfill(arr_app, channel_id):
    """Re-index the channel's whole history and wait for it to finish."""
    (await arr_app.http.post(f"/api/channels/{channel_id}/backfill")).raise_for_status()

    async def finished():
        logs = (await arr_app.http.get("/api/logs", params={"channel_id": channel_id})).json()
        return any("[Backfill]" in line["message"] for line in logs)

    await eventually(finished)


@pytest.mark.asyncio
@pytest.mark.parametrize("assignment", [{"tmdb_id": THEORY_TMDB}, {"imdb_id": THEORY_IMDB}])
async def test_assigning_a_film_offers_the_release_to_radarr(arr_app, films, assignment):
    channel, msg = await _one_pending(arr_app)

    r = await arr_app.http.post(f"/api/review/{channel['id']}/{msg.id}/assign", json=assignment)

    assert r.status_code == 200
    assert await _review(arr_app) == []
    items = await _movie_search(arr_app, tmdbid=str(THEORY_TMDB))
    assert [i.find("title").text for i in items] == ["The.Theory.of.Everything.2014.CAT.1080p.WEB-DL.x264-TELEGRARR"]
    assert _attrs(items[0])["imdb"] == THEORY_IMDB.removeprefix("tt")


@pytest.mark.asyncio
async def test_an_assigned_film_can_be_grabbed_into_the_movies_folder(arr_app, films):
    channel, msg = await _one_pending(arr_app)
    (await arr_app.http.post(f"/api/review/{channel['id']}/{msg.id}/assign",
                             json={"tmdb_id": THEORY_TMDB})).raise_for_status()

    r = await arr_app.http.get("/sabnzbd/api", params={
        "mode": "addurl", "apikey": arr_app.apikey, "cat": "movies",
        "name": f"http://x/api/newznab/nzb?id={channel['id']}_{msg.id}"})
    slot = await arr_app.history_slot(r.json()["nzo_ids"][0])

    assert slot["status"] == "Completed"
    assert slot["storage"].endswith("/telegram/movies/The.Theory.of.Everything.2014.CAT.1080p.WEB-DL.x264-TELEGRARR")


@pytest.mark.asyncio
async def test_assigning_an_unknown_film_is_rejected_and_stays_pending(arr_app, films):
    channel, msg = await _one_pending(arr_app)

    r = await arr_app.http.post(f"/api/review/{channel['id']}/{msg.id}/assign", json={"imdb_id": "tt0000001"})

    assert r.status_code == 400
    assert "no film" in r.json()["detail"]
    assert len(await _review(arr_app)) == 1


@pytest.mark.asyncio
async def test_assigning_without_an_id_is_rejected(arr_app, films):
    channel, msg = await _one_pending(arr_app)

    r = await arr_app.http.post(f"/api/review/{channel['id']}/{msg.id}/assign", json={})

    assert r.status_code == 400
    assert len(await _review(arr_app)) == 1


@pytest.mark.asyncio
async def test_reviewing_a_message_that_is_not_pending_is_not_found(arr_app, films):
    channel, _ = await _one_pending(arr_app)

    assign = await arr_app.http.post(f"/api/review/{channel['id']}/999/assign", json={"tmdb_id": THEORY_TMDB})
    discard = await arr_app.http.post(f"/api/review/{channel['id']}/999/discard")

    assert (assign.status_code, discard.status_code) == (404, 404)


@pytest.mark.asyncio
async def test_a_discarded_message_is_never_shown_or_offered_again(arr_app, films):
    channel, msg = await _one_pending(arr_app, text="La teoria del tot (1999)")

    r = await arr_app.http.post(f"/api/review/{channel['id']}/{msg.id}/discard")
    await _backfill(arr_app, channel["id"])

    assert r.status_code == 200
    assert await _review(arr_app) == []
    assert await _movie_search(arr_app) == []
    assert films.movie_searches() == [("La teoria del tot", "ca-ES", "1999"), ("La teoria del tot", "en-US", "1999")]


@pytest.mark.asyncio
async def test_backfill_keeps_an_assigned_film_and_does_not_look_it_up_again(arr_app, films):
    channel, msg = await _one_pending(arr_app)
    (await arr_app.http.post(f"/api/review/{channel['id']}/{msg.id}/assign",
                             json={"tmdb_id": THEORY_TMDB})).raise_for_status()

    await _backfill(arr_app, channel["id"])

    assert await _review(arr_app) == []
    assert len(await _movie_search(arr_app, tmdbid=str(THEORY_TMDB))) == 1
    assert films.movie_searches() == []


@pytest.mark.asyncio
async def test_standalone_mode_downloads_matched_films_but_not_pending_ones(arr_app, films):
    (await arr_app.http.patch("/api/settings", json={"operating_mode": "standalone"})).raise_for_status()
    channel = await _movie_channel(arr_app)
    matched = arr_app.telegram.post(MOVIE_CHAT, text="Pa negre (2010)", file_name="Pa_negre_2010_720p.mkv")
    arr_app.telegram.post(MOVIE_CHAT, text="Sense any", file_name="sense_any.mkv")

    await arr_app.scan(channel["id"])

    async def downloaded():
        return arr_app.telegram.downloaded
    assert await eventually(downloaded) == [(MOVIE_CHAT, matched.id)]


@pytest.mark.asyncio
async def test_tmdb_film_search_for_the_review_picker(arr_app, films):
    await _movie_channel(arr_app)

    r = await arr_app.http.get("/api/tmdb/movies", params={"q": "teoria del tot"})

    assert [(h["tmdb_id"], h["title"], h["year"]) for h in r.json()] == [(THEORY_TMDB, "La teoria del tot", "2014")]
