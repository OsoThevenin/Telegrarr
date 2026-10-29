"""Movie-channel Catalog: every film a movie channel offers, built only from what
Telegrarr already stores (indexed releases plus that channel's pending review).

Driven over HTTP (``arr_app``) with TMDB faked at the httpx transport level
(``fake_tmdb``) and Telegram faked by the harness.
"""
import pytest

from fake_tmdb import API_KEY

MOVIE_CHAT = -1003333333333
THEORY_TMDB, THEORY_IMDB = 266856, "tt2980516"
PA_NEGRE_TMDB, PA_NEGRE_IMDB = 50797, "tt1302067"
MB = 1024 * 1024


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


async def _catalog(arr_app, cid) -> dict:
    r = await arr_app.http.get(f"/api/channels/{cid}/catalog")
    assert r.status_code == 200, r.text
    return r.json()


@pytest.mark.asyncio
async def test_an_indexed_film_is_a_catalog_row_with_its_catalan_title_quality_size_and_language(arr_app, films):
    channel = await _movie_channel(arr_app)
    arr_app.telegram.post(MOVIE_CHAT, text="La teoria del tot (2014)", file_name="La.teoria.del.tot.2014.1080p.mkv",
                          content=b"x" * 3000)
    await arr_app.scan(channel["id"])

    catalog = await _catalog(arr_app, channel["id"])

    assert catalog["count"] == 1
    [row] = catalog["rows"]
    assert _subset(row, FILM_FIELDS) == {
        "kind": "film", "tmdb_id": THEORY_TMDB, "imdb_id": THEORY_IMDB, "title": "La teoria del tot",
        "year": 2014, "quality": "1080p", "size": 3000, "language": "CAT",
    }


FILM_FIELDS = ("kind", "tmdb_id", "imdb_id", "title", "year", "quality", "size", "language")


def _subset(row: dict, fields) -> dict:
    """The named fields of ``row`` (later slices add fields to Catalog rows)."""
    return {k: row.get(k) for k in fields}


@pytest.mark.asyncio
async def test_several_releases_of_one_film_are_one_row_with_the_highest_resolution(arr_app, films):
    channel = await _movie_channel(arr_app)
    arr_app.telegram.post(MOVIE_CHAT, text="La teoria del tot (2014) 720p", file_name="Teoria.2014.720p.mkv",
                          content=b"x" * 9000)
    arr_app.telegram.post(MOVIE_CHAT, text="La teoria del tot (2014) 2160p", file_name="Teoria.2014.2160p.mkv",
                          content=b"x" * 5000)
    arr_app.telegram.post(MOVIE_CHAT, text="La teoria del tot (2014) 1080p", file_name="Teoria.2014.1080p.mkv",
                          content=b"x" * 7000)
    await arr_app.scan(channel["id"])

    [row] = (await _catalog(arr_app, channel["id"]))["rows"]

    assert _subset(row, ("tmdb_id", "quality", "size")) == {"tmdb_id": THEORY_TMDB, "quality": "2160p", "size": 5000}


@pytest.mark.asyncio
async def test_releases_of_one_film_at_the_same_resolution_keep_the_larger_file(arr_app, films):
    channel = await _movie_channel(arr_app)
    arr_app.telegram.post(MOVIE_CHAT, text="La teoria del tot (2014) 1080p x264", file_name="Teoria.2014.1080p.a.mkv",
                          content=b"x" * 4000)
    arr_app.telegram.post(MOVIE_CHAT, text="La teoria del tot (2014) 1080p x265", file_name="Teoria.2014.1080p.b.mkv",
                          content=b"x" * 6000)
    await arr_app.scan(channel["id"])

    [row] = (await _catalog(arr_app, channel["id"]))["rows"]

    assert (row["quality"], row["size"]) == ("1080p", 6000)


@pytest.mark.asyncio
async def test_a_film_indexed_before_titles_were_stored_is_titled_from_its_release_name(arr_app, films):
    from app import db

    channel = await _movie_channel(arr_app)
    arr_app.telegram.post(MOVIE_CHAT, text="La teoria del tot (2014)", file_name="La.teoria.del.tot.2014.1080p.mkv")
    await arr_app.scan(channel["id"])
    with db.conn() as c:     # a row from an older version: no movie_title column value
        c.execute("UPDATE releases SET movie_title=NULL")

    [row] = (await _catalog(arr_app, channel["id"]))["rows"]

    assert (row["title"], row["year"]) == ("The Theory of Everything", 2014)


@pytest.mark.asyncio
async def test_rows_come_newest_first_with_unidentified_messages_among_the_films(arr_app, films):
    channel = await _movie_channel(arr_app)
    arr_app.telegram.post(MOVIE_CHAT, text="Pa negre (2010)", file_name="Pa_negre_2010_720p.mkv")
    unknown = arr_app.telegram.post(MOVIE_CHAT, text="", file_name="La.casa.del.llac.CAT.1080p.mkv",
                                    content=b"x" * 2200)
    arr_app.telegram.post(MOVIE_CHAT, text="La teoria del tot (2014)", file_name="La.teoria.del.tot.2014.1080p.mkv")
    await arr_app.scan(channel["id"])

    catalog = await _catalog(arr_app, channel["id"])

    assert [r["kind"] for r in catalog["rows"]] == ["film", "unidentified", "film"]
    assert [r.get("tmdb_id") for r in catalog["rows"]] == [THEORY_TMDB, None, PA_NEGRE_TMDB]
    assert catalog["count"] == 3
    assert _subset(catalog["rows"][1], ("review", "title", "quality", "size", "language")) == {
        "review": {"channel_id": channel["id"], "message_id": unknown.id},
        "title": "La.casa.del.llac.CAT.1080p.mkv", "quality": "1080p", "size": 2200, "language": "CAT"}


@pytest.mark.asyncio
async def test_rows_follow_post_order_even_when_a_scan_crosses_a_second(arr_app, films):
    from app import db

    channel = await _movie_channel(arr_app)
    arr_app.telegram.post(MOVIE_CHAT, text="Pa negre (2010)", file_name="Pa_negre_2010_720p.mkv")
    arr_app.telegram.post(MOVIE_CHAT, text="", file_name="La.casa.del.llac.CAT.1080p.mkv")
    arr_app.telegram.post(MOVIE_CHAT, text="La teoria del tot (2014)", file_name="La.teoria.del.tot.2014.1080p.mkv")
    await arr_app.scan(channel["id"])
    with db.conn() as c:     # the oldest post was indexed a second after the others
        c.execute("UPDATE releases SET added_at=added_at+1 WHERE movie_tmdb_id=?", (PA_NEGRE_TMDB,))

    catalog = await _catalog(arr_app, channel["id"])

    assert [r.get("tmdb_id") for r in catalog["rows"]] == [THEORY_TMDB, None, PA_NEGRE_TMDB]


@pytest.mark.asyncio
async def test_a_discarded_review_message_is_not_in_the_catalog(arr_app, films):
    channel = await _movie_channel(arr_app)
    unknown = arr_app.telegram.post(MOVIE_CHAT, text="", file_name="La.casa.del.llac.mkv")
    await arr_app.scan(channel["id"])

    (await arr_app.http.post(f"/api/review/{channel['id']}/{unknown.id}/discard")).raise_for_status()

    assert (await _catalog(arr_app, channel["id"]))["rows"] == []


@pytest.mark.asyncio
async def test_building_the_catalog_asks_telegram_nothing(arr_app, films):
    channel = await _movie_channel(arr_app)
    arr_app.telegram.post(MOVIE_CHAT, text="La teoria del tot (2014)", file_name="La.teoria.del.tot.2014.1080p.mkv")
    arr_app.telegram.post(MOVIE_CHAT, text="", file_name="La.casa.del.llac.mkv")
    await arr_app.scan(channel["id"])
    tg = arr_app.telegram
    before = (len(tg.lookups), len(tg.requests), len(tg.history_reads))

    await _catalog(arr_app, channel["id"])

    assert (len(tg.lookups), len(tg.requests), len(tg.history_reads)) == before


FORUM = -1007100000001


@pytest.mark.asyncio
async def test_a_topic_channels_catalog_lists_only_that_topics_films(arr_app, films):
    (await arr_app.http.patch("/api/settings", json={"tmdb_key": API_KEY})).raise_for_status()
    forum = arr_app.telegram.add_forum(FORUM, "Cinema en català", topics=("Estrenes", "Clàssics"))
    estrenes = await arr_app.add_channel(FORUM, kind="movie", topic_id=forum.topic_id("Estrenes"),
                                         topic_title="Estrenes")
    classics = await arr_app.add_channel(FORUM, kind="movie", topic_id=forum.topic_id("Clàssics"),
                                         topic_title="Clàssics")
    arr_app.telegram.post(FORUM, text="La teoria del tot (2014)", file_name="La.teoria.del.tot.2014.1080p.mkv",
                          topic=forum.topic_id("Estrenes"))
    arr_app.telegram.post(FORUM, text="Pa negre (2010)", file_name="Pa_negre_2010_720p.mkv",
                          topic=forum.topic_id("Clàssics"))
    arr_app.telegram.post(FORUM, text="", file_name="La.casa.del.llac.mkv", topic=forum.topic_id("Clàssics"))
    await arr_app.scan(estrenes["id"])
    await arr_app.scan(classics["id"])

    estrenes_rows = (await _catalog(arr_app, estrenes["id"]))["rows"]
    classics_rows = (await _catalog(arr_app, classics["id"]))["rows"]

    assert [(r["kind"], r.get("tmdb_id")) for r in estrenes_rows] == [("film", THEORY_TMDB)]
    assert [(r["kind"], r.get("tmdb_id")) for r in classics_rows] == [("unidentified", None),
                                                                      ("film", PA_NEGRE_TMDB)]


@pytest.mark.asyncio
async def test_the_catalog_of_a_series_channel_is_a_keyed_error(arr_app):
    arr_app.telegram.add_channel(MOVIE_CHAT, "Sèries")
    series = await arr_app.add_channel(MOVIE_CHAT, kind="tv")

    r = await arr_app.http.get(f"/api/channels/{series['id']}/catalog")

    assert r.status_code == 400
    assert r.json()["detail"] == {"key": "err.catalog.not_movie_channel", "params": {}}


@pytest.mark.asyncio
async def test_the_catalog_of_an_unknown_channel_is_a_keyed_error(arr_app):
    r = await arr_app.http.get("/api/channels/999/catalog")

    assert r.status_code == 404
    assert r.json()["detail"] == {"key": "err.catalog.unknown_channel", "params": {"id": 999}}


@pytest.mark.asyncio
async def test_the_catalog_module_is_served_and_used_by_the_channel_drawer(arr_app):
    module = await arr_app.http.get("/static/js/catalog.js")
    views = await arr_app.http.get("/static/js/views.js")
    worker = await arr_app.http.get("/static/sw.js")

    assert module.status_code == 200
    assert "javascript" in module.headers["content-type"]
    assert "pageUrl(" in module.text and "/api/channels/" in module.text   # pages via catalog-filters.js
    assert "/scan`" in module.text          # the empty state's Escaneja ara uses the per-channel scan
    assert 'from "./catalog.js"' in views.raise_for_status().text
    assert '"/static/js/catalog.js"' in worker.raise_for_status().text


@pytest.mark.asyncio
async def test_the_catalog_needs_a_signed_in_user(arr_app):
    arr_app.http.cookies.clear()

    r = await arr_app.http.get("/api/channels/1/catalog")

    assert r.status_code == 401
