"""Forum groups as sources (#23), driven over HTTP as Sonarr/Radarr and the UI do.

A forum group added as a whole chat (no topic) behaves exactly as a channel
always has: scans and directory scans read every topic's messages.
"""
import sqlite3
import xml.etree.ElementTree as ET

import pytest

from fake_tmdb import API_KEY
from http_harness import eventually

FORUM = -1007100000001
MERLI = -1007100000002


@pytest.fixture(autouse=True)
def _isolated_directory_scans(monkeypatch):
    """Directory resolutions are spaced out for account safety; tests don't wait.
    Each test starts with no cached scans and an open FloodWait gate."""
    from app import directory, downloader
    from app.safety import FloodGate

    monkeypatch.setattr(directory, "RESOLVE_INTERVAL_S", 0)
    directory.forget_scans()
    monkeypatch.setattr(downloader, "flood_gate", FloodGate())


def _titles(feed_xml: str) -> set[str]:
    return {i.find("title").text for i in ET.fromstring(feed_xml).findall("./channel/item")}


@pytest.mark.asyncio
async def test_whole_forum_source_indexes_posts_from_every_topic_and_general(arr_app):
    tg = arr_app.telegram
    forum = tg.add_forum(FORUM, "The Show", topics=("Sèries HD", "Novetats"))
    tg.post(FORUM, text="The Show S01E01 1080p", file_name="The.Show.S01E01.mkv",
            topic=forum.topic_id("Sèries HD"))
    tg.post(FORUM, text="The Show S01E02 1080p", file_name="The.Show.S01E02.mkv",
            topic=forum.topic_id("Novetats"))
    tg.post(FORUM, text="The Show S01E03 1080p", file_name="The.Show.S01E03.mkv")
    channel = await arr_app.add_channel(FORUM, kind="tv")

    await arr_app.scan(channel["id"])

    r = await arr_app.http.get("/api/newznab", params={"t": "tvsearch", "apikey": arr_app.apikey,
                                                      "q": "the show"})
    assert {t.split(".CAT.")[0] for t in _titles(r.raise_for_status().text)} == {
        "The.Show.S01E01", "The.Show.S01E02", "The.Show.S01E03"}


@pytest.mark.asyncio
async def test_directory_scan_of_a_whole_forum_lists_links_from_every_topic(arr_app):
    tg = arr_app.telegram
    forum = tg.add_forum(FORUM, "Anime en català", topics=("Sèries HD",))
    tg.add_channel(MERLI, "Merlí [CAT] 1080p", username="merli_cat")
    tg.post_text(FORUM, "Merlí: https://t.me/merli_cat", topic=forum.topic_id("Sèries HD"))
    tg.post_text(FORUM, "Missing: https://t.me/no_such_cat")

    r = await arr_app.http.post("/api/directory/scan", json={"chat_id": FORUM})

    links = {e["link"]: e for e in r.raise_for_status().json()["links"]}
    assert set(links) == {"https://t.me/merli_cat", "https://t.me/no_such_cat"}
    assert links["https://t.me/merli_cat"]["chat_id"] == MERLI


async def _listed(arr_app) -> list[dict]:
    return (await arr_app.http.get("/api/channels")).raise_for_status().json()


@pytest.mark.asyncio
async def test_a_topic_source_is_stored_and_listed_with_its_topic(arr_app):
    forum = arr_app.telegram.add_forum(FORUM, "Anime en català", topics=("Pel·lícules HD",))
    tid = forum.topic_id("Pel·lícules HD")

    added = await arr_app.add_channel(FORUM, kind="movie", topic_id=tid, topic_title="Pel·lícules HD")

    [row] = await _listed(arr_app)
    assert row["id"] == added["id"]
    assert (row["chat_id"], row["topic_id"], row["topic_title"]) == (FORUM, tid, "Pel·lícules HD")
    assert row["title"] == "Anime en català"


@pytest.mark.asyncio
@pytest.mark.parametrize("topic_id", ["Novetats", 0, -3, True])
async def test_a_topic_id_that_is_not_a_positive_number_is_rejected(arr_app, topic_id):
    arr_app.telegram.add_forum(FORUM, "Anime en català", topics=("Novetats",))

    r = await arr_app.http.post("/api/channels", json={"chat_id": FORUM, "topic_id": topic_id})

    assert r.status_code == 400
    assert r.json()["detail"]["key"] == "err.channel.topic_id_numeric"
    assert await _listed(arr_app) == []


@pytest.mark.asyncio
async def test_a_numeric_text_topic_id_is_accepted(arr_app):
    forum = arr_app.telegram.add_forum(FORUM, "Anime en català", topics=("Novetats",))
    tid = forum.topic_id("Novetats")

    added = await arr_app.add_channel(FORUM, topic_id=str(tid))

    assert added["topic_id"] == tid


@pytest.mark.asyncio
async def test_re_adding_the_same_topic_updates_its_source(arr_app):
    forum = arr_app.telegram.add_forum(FORUM, "Anime en català", topics=("Novetats",))
    tid = forum.topic_id("Novetats")
    first = await arr_app.add_channel(FORUM, kind="movie", topic_id=tid, topic_title="Novetats")

    again = await arr_app.add_channel(FORUM, kind="tv", topic_id=tid, topic_title="Novetats")

    [row] = await _listed(arr_app)
    assert again["id"] == first["id"] == row["id"]
    assert row["kind"] == "tv"


@pytest.mark.asyncio
async def test_a_whole_chat_source_and_a_topic_source_of_one_group_coexist(arr_app):
    forum = arr_app.telegram.add_forum(FORUM, "Anime en català", topics=("Novetats",))
    whole = await arr_app.add_channel(FORUM, kind="tv")

    topic = await arr_app.add_channel(FORUM, kind="movie", topic_id=forum.topic_id("Novetats"))
    whole_again = await arr_app.add_channel(FORUM, kind="tv")

    assert whole_again["id"] == whole["id"] != topic["id"]
    assert {(c["id"], c["topic_id"]) for c in await _listed(arr_app)} == {
        (whole["id"], None), (topic["id"], forum.topic_id("Novetats"))}


THEORY_TMDB, THEORY_IMDB = 266856, "tt2980516"
PA_NEGRE_TMDB, PA_NEGRE_IMDB = 50797, "tt1302067"


@pytest.fixture()
def films(fake_tmdb):
    fake_tmdb.add_movie(THEORY_TMDB, titles={"ca-ES": "La teoria del tot", "en-US": "The Theory of Everything"},
                        release_date="2014-11-07", imdb_id=THEORY_IMDB)
    fake_tmdb.add_movie(PA_NEGRE_TMDB, titles={"ca-ES": "Pa negre", "en-US": "Black Bread"},
                        original_title="Pa negre", release_date="2010-10-15", imdb_id=PA_NEGRE_IMDB)
    return fake_tmdb


async def _movie_search(arr_app, **params) -> set[str]:
    r = await arr_app.http.get("/api/newznab", params={"t": "movie", "apikey": arr_app.apikey, **params})
    return _titles(r.raise_for_status().text)


async def _review(arr_app) -> list[dict]:
    return (await arr_app.http.get("/api/review")).raise_for_status().json()


async def _film_forum(arr_app, topics=("Pel·lícules HD", "Novetats")):
    """A forum whose "Pel·lícules HD" topic is a movie source; returns (forum, source)."""
    (await arr_app.http.patch("/api/settings", json={"tmdb_key": API_KEY})).raise_for_status()
    forum = arr_app.telegram.add_forum(FORUM, "Anime en català", topics=topics)
    source = await arr_app.add_channel(FORUM, kind="movie", topic_id=forum.topic_id("Pel·lícules HD"),
                                       topic_title="Pel·lícules HD")
    return forum, source


THEORY_POST = dict(text="La teoria del tot (2014) - Català - 1080p", file_name="La.teoria.del.tot.2014.1080p.mkv")
THEORY_RELEASE = "The.Theory.of.Everything.2014.CAT.1080p.WEB-DL.x264-TELEGRARR"


@pytest.mark.asyncio
async def test_a_movie_topic_offers_only_its_own_films_to_radarr(arr_app, films):
    forum, source = await _film_forum(arr_app)
    arr_app.telegram.post(FORUM, **THEORY_POST, topic=forum.topic_id("Pel·lícules HD"))
    arr_app.telegram.post(FORUM, text="Pa negre (2010)", file_name="Pa_negre_2010_720p.mkv",
                          topic=forum.topic_id("Novetats"))
    arr_app.telegram.post(FORUM, text="Una pel·lícula sense any", file_name="sense_any.mkv")

    await arr_app.scan(source["id"])

    assert await _movie_search(arr_app, tmdbid=str(THEORY_TMDB)) == {THEORY_RELEASE}
    assert await _movie_search(arr_app, tmdbid=str(PA_NEGRE_TMDB)) == set()
    assert await _review(arr_app) == []


async def _backfill(arr_app, channel_id):
    """Re-index the source's whole history and wait for it to finish."""
    (await arr_app.http.post(f"/api/channels/{channel_id}/backfill")).raise_for_status()

    async def finished():
        logs = (await arr_app.http.get("/api/logs", params={"channel_id": channel_id})).json()
        return any("[Backfill]" in line["message"] for line in logs)

    await eventually(finished)


@pytest.mark.asyncio
async def test_backfill_of_a_topic_indexes_only_that_topics_history(arr_app, films):
    forum, source = await _film_forum(arr_app)
    arr_app.telegram.post(FORUM, **THEORY_POST, topic=forum.topic_id("Pel·lícules HD"))
    arr_app.telegram.post(FORUM, text="Pa negre (2010)", file_name="Pa_negre_2010_720p.mkv",
                          topic=forum.topic_id("Novetats"))
    arr_app.telegram.post(FORUM, text="Una pel·lícula sense any", file_name="sense_any.mkv")

    await _backfill(arr_app, source["id"])

    assert await _movie_search(arr_app, tmdbid=str(THEORY_TMDB)) == {THEORY_RELEASE}
    assert await _movie_search(arr_app, tmdbid=str(PA_NEGRE_TMDB)) == set()
    assert await _review(arr_app) == []


PRE_TOPICS_CHANNELS = """CREATE TABLE channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id INTEGER NOT NULL UNIQUE, title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'tv', imdb_id TEXT, imdb_title TEXT,
  weekdays TEXT NOT NULL DEFAULT '0,1,2,3,4,5,6', poll_minutes INTEGER NOT NULL DEFAULT 15,
  enabled INTEGER NOT NULL DEFAULT 1, last_scanned_at INTEGER DEFAULT 0,
  last_message_id INTEGER DEFAULT 0, created_at INTEGER NOT NULL,
  language TEXT NOT NULL DEFAULT 'cat', fallback_quality TEXT NOT NULL DEFAULT '1080p',
  tvdb_id INTEGER, tmdb_id INTEGER)"""


def _upgrade_from_a_pre_topics_db(dbfile: str, *rows: tuple[int, int, str, str]) -> None:
    """Make the DB look like v1.0.1's, holding sources (id, chat_id, title, kind),
    then start the app's schema init on it as an upgrade does."""
    from app import db

    with sqlite3.connect(dbfile) as c:
        c.execute("DROP TABLE channels")
        c.execute(PRE_TOPICS_CHANNELS)
        c.executemany("INSERT INTO channels(id,chat_id,title,kind,created_at) VALUES(?,?,?,?,0)", rows)
    db.init()


@pytest.mark.asyncio
async def test_a_source_added_before_topics_existed_still_scans_and_is_found(arr_app, fresh_db, films):
    (await arr_app.http.patch("/api/settings", json={"tmdb_key": API_KEY})).raise_for_status()
    forum = arr_app.telegram.add_forum(FORUM, "Anime en català", topics=("Pel·lícules HD",))
    _upgrade_from_a_pre_topics_db(fresh_db, (7, FORUM, "Anime en català", "movie"))
    arr_app.telegram.post(FORUM, **THEORY_POST, topic=forum.topic_id("Pel·lícules HD"))

    [old] = await _listed(arr_app)
    await arr_app.scan(old["id"])
    topic = await arr_app.add_channel(FORUM, kind="movie", topic_id=forum.topic_id("Pel·lícules HD"))

    assert (old["id"], old["topic_id"], old["topic_title"]) == (7, None, None)
    assert await _movie_search(arr_app, tmdbid=str(THEORY_TMDB)) == {THEORY_RELEASE}
    assert topic["id"] > 7
    assert {c["id"] for c in await _listed(arr_app)} == {7, topic["id"]}


MERLI_TMDB, MERLI_TVDB = 61662, 297571


@pytest.mark.asyncio
async def test_two_topics_of_one_group_are_separate_sources_of_different_kinds(arr_app, films):
    films.add_series(MERLI_TMDB, titles={"ca-ES": "Merlí"}, tvdb_id=MERLI_TVDB, imdb_id="tt4807092")
    forum, movies = await _film_forum(arr_app, topics=("Pel·lícules HD", "Novetats", "Sèries HD"))
    series_tid = forum.topic_id("Sèries HD")
    series = await arr_app.add_channel(FORUM, kind="tv", topic_id=series_tid, topic_title="Sèries HD")
    (await arr_app.http.put(f"/api/channels/{series['id']}/series",
                            json={"tmdb_id": MERLI_TMDB, "title": "Merlí"})).raise_for_status()
    arr_app.telegram.post(FORUM, text="Merlí S01E01 1080p", file_name="Merli.S01E01.mkv", topic=series_tid)
    arr_app.telegram.post(FORUM, text="Merlí S01E02 1080p", file_name="Merli.S01E02.mkv",
                          topic=forum.topic_id("Novetats"))
    arr_app.telegram.post(FORUM, **THEORY_POST, topic=forum.topic_id("Pel·lícules HD"))

    await arr_app.scan(series["id"])
    await arr_app.scan(movies["id"])

    listed = {(c["topic_title"], c["kind"]) for c in await _listed(arr_app)}
    assert listed == {("Pel·lícules HD", "movie"), ("Sèries HD", "tv")}
    r = await arr_app.http.get("/api/newznab", params={"t": "tvsearch", "apikey": arr_app.apikey,
                                                      "tvdbid": str(MERLI_TVDB)})
    assert {t.split(".CAT.")[0] for t in _titles(r.raise_for_status().text)} == {"Merlí.S01E01"}
    assert await _movie_search(arr_app, tmdbid=str(THEORY_TMDB)) == {THEORY_RELEASE}
    assert await _review(arr_app) == []
