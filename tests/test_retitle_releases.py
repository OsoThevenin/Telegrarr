"""Already-indexed TV Releases are retitled on remap and at startup.

Release titles are stored at scan time; without re-deriving them, a remapped
Channel keeps offering the previous series' title and Releases indexed under the
old naming (TMDB year in the title) never get Sonarr's title. Driven over HTTP
(``arr_app``) with TMDB and Sonarr faked at the httpx transport level.
"""
import xml.etree.ElementTree as ET

import pytest

from fake_arr import SONARR_KEY
from fake_tmdb import API_KEY

CHAT = -1009600000001
MOVIE_CHAT = -1009600000002
TMDB_ID, TVDB_ID = 96001, 396001
OTHER_TMDB_ID, OTHER_TVDB_ID = 96002, 396002

EXAMPLE_SHOW = {"id": 21, "tvdbId": TVDB_ID, "title": "Example Show", "year": 2001,
                "cleanTitle": "exampleshow"}
OTHER_SHOW = {"id": 22, "tvdbId": OTHER_TVDB_ID, "title": "Other Show (1979)", "year": 1979,
              "cleanTitle": "othershow1979"}


async def _connect(arr_app, fake_tmdb, arrs, *series: dict) -> None:
    fake_tmdb.add_series(TMDB_ID, titles={"en-US": "Example Show"}, tvdb_id=TVDB_ID,
                         first_air_date="2002-03-01")
    fake_tmdb.add_series(OTHER_TMDB_ID, titles={"en-US": "Other Show"}, tvdb_id=OTHER_TVDB_ID,
                         first_air_date="1979-01-07")
    (await arr_app.http.patch("/api/settings", json={
        "tmdb_key": API_KEY, "sonarr_url": "http://sonarr.test:8989", "sonarr_key": SONARR_KEY,
    })).raise_for_status()
    arrs.sonarr.series.extend(series)


async def _map(arr_app, channel: dict, tmdb_id: int, title: str = "") -> None:
    body = {"tmdb_id": tmdb_id, **({"title": title} if title else {})}
    (await arr_app.http.put(f"/api/channels/{channel['id']}/series", json=body)).raise_for_status()


async def _mapped_channel(arr_app) -> dict:
    arr_app.telegram.add_channel(CHAT, "Example Show CAT")
    channel = await arr_app.add_channel(CHAT, kind="tv")
    await _map(arr_app, channel, TMDB_ID)
    return channel


async def _publish(arr_app, channel: dict, *texts: str) -> None:
    for text in texts:
        arr_app.telegram.post(CHAT, text=text, file_name=f"{text}.mkv")
    await arr_app.scan(channel["id"])


async def _tv_titles(arr_app, tvdb_id: int) -> list[str]:
    """Release titles a tvsearch by TVDB id returns, as Sonarr sees them."""
    r = await arr_app.http.get("/api/newznab", params={"t": "tvsearch", "apikey": arr_app.apikey,
                                                       "tvdbid": tvdb_id})
    items = ET.fromstring(r.raise_for_status().text).findall("./channel/item/title")
    return sorted(t.text for t in items)


@pytest.mark.asyncio
async def test_remapping_a_channel_retitles_its_indexed_releases(arr_app, fake_tmdb, arrs):
    await _connect(arr_app, fake_tmdb, arrs, EXAMPLE_SHOW, OTHER_SHOW)
    channel = await _mapped_channel(arr_app)
    await _publish(arr_app, channel, "Example Show 5x26 1080p")

    await _map(arr_app, channel, OTHER_TMDB_ID)

    titles = await _tv_titles(arr_app, OTHER_TVDB_ID)
    assert titles == ["Other.Show.1979.S05E26.CAT.1080p.WEB-DL.x264-TELEGRARR"]


@pytest.mark.asyncio
async def test_remapping_retitles_without_reading_telegram_again(arr_app, fake_tmdb, arrs):
    await _connect(arr_app, fake_tmdb, arrs, EXAMPLE_SHOW, OTHER_SHOW)
    channel = await _mapped_channel(arr_app)
    await _publish(arr_app, channel, "Example Show 5x25 720p", "Example Show 5x26 1080p")
    arr_app.telegram.lose_access(CHAT)

    await _map(arr_app, channel, OTHER_TMDB_ID)

    titles = await _tv_titles(arr_app, OTHER_TVDB_ID)
    assert titles == ["Other.Show.1979.S05E25.CAT.720p.WEB-DL.x264-TELEGRARR",
                      "Other.Show.1979.S05E26.CAT.1080p.WEB-DL.x264-TELEGRARR"]


@pytest.mark.asyncio
async def test_a_multi_episode_release_keeps_both_episodes_when_retitled(arr_app, fake_tmdb, arrs):
    await _connect(arr_app, fake_tmdb, arrs, EXAMPLE_SHOW, OTHER_SHOW)
    channel = await _mapped_channel(arr_app)
    arr_app.telegram.post(CHAT, text="", file_name="Serie_1x01-02_Doble.mkv")
    await arr_app.scan(channel["id"])

    await _map(arr_app, channel, OTHER_TMDB_ID)

    titles = await _tv_titles(arr_app, OTHER_TVDB_ID)
    assert titles == ["Other.Show.1979.S01E01E02.CAT.1080p.WEB-DL.x264-TELEGRARR"]


# Releases indexed before the Sonarr-title fix carried TMDB's premiere year.
CURRENT_TO_OLD_NAMING = {
    "Example.Show.S05E25.CAT.720p.WEB-DL.x264-TELEGRARR":
        "Example.Show.2002.S05E25.CAT.720p.WEB-DL.x264-TELEGRARR",
    "Example.Show.S05E26.CAT.1080p.WEB-DL.x264-TELEGRARR":
        "Example.Show.2002.S05E26.CAT.1080p.WEB-DL.x264-TELEGRARR",
}


async def _indexed_under_old_naming(arr_app, fake_tmdb, arrs) -> None:
    """A mapped Channel whose Releases carry the old titles (no current code path
    writes them, so the stored rows are rewritten as an upgraded database has them)."""
    from app import db
    await _connect(arr_app, fake_tmdb, arrs, EXAMPLE_SHOW)
    channel = await _mapped_channel(arr_app)
    await _publish(arr_app, channel, "Example Show 5x25 720p", "Example Show 5x26 1080p")
    with db.conn() as c:
        for current, old in CURRENT_TO_OLD_NAMING.items():
            c.execute("UPDATE releases SET title=? WHERE title=?", (old, current))
    assert await _tv_titles(arr_app, TVDB_ID) == sorted(CURRENT_TO_OLD_NAMING.values())


@pytest.mark.asyncio
async def test_the_startup_refresh_retitles_releases_indexed_under_the_old_naming(
        arr_app, fake_tmdb, arrs):
    from app import release_titles
    await _indexed_under_old_naming(arr_app, fake_tmdb, arrs)

    await release_titles.refresh_all()

    assert await _tv_titles(arr_app, TVDB_ID) == sorted(CURRENT_TO_OLD_NAMING)


@pytest.mark.asyncio
async def test_running_the_startup_refresh_again_changes_nothing(arr_app, fake_tmdb, arrs):
    from app import release_titles
    await _indexed_under_old_naming(arr_app, fake_tmdb, arrs)
    await release_titles.refresh_all()

    changed = await release_titles.refresh_all()

    assert changed == 0
    assert await _tv_titles(arr_app, TVDB_ID) == sorted(CURRENT_TO_OLD_NAMING)


@pytest.mark.asyncio
async def test_the_startup_refresh_with_sonarr_down_leaves_correct_titles_alone(
        arr_app, fake_tmdb, arrs):
    from app import db, release_titles
    await _connect(arr_app, fake_tmdb, arrs, {**EXAMPLE_SHOW, "title": "Example Show (2001)"})
    channel = await _mapped_channel(arr_app)
    await _publish(arr_app, channel, "Example Show 5x26 1080p")
    with db.conn() as c:   # a fresh boot of an upgraded database: no Sonarr title cached yet
        c.execute("DELETE FROM sonarr_titles")
    arrs.sonarr.fail_status = 503

    changed = await release_titles.refresh_all()

    assert changed == 0
    titles = await _tv_titles(arr_app, TVDB_ID)
    assert titles == ["Example.Show.2001.S05E26.CAT.1080p.WEB-DL.x264-TELEGRARR"]


@pytest.mark.asyncio
async def test_remapping_with_sonarr_down_retitles_after_the_new_mapped_title(
        arr_app, fake_tmdb, arrs):
    await _connect(arr_app, fake_tmdb, arrs, EXAMPLE_SHOW, OTHER_SHOW)
    channel = await _mapped_channel(arr_app)
    await _publish(arr_app, channel, "Example Show 5x26 1080p")
    arrs.sonarr.fail_status = 503

    await _map(arr_app, channel, OTHER_TMDB_ID, title="Other Show (1979)")

    titles = await _tv_titles(arr_app, OTHER_TVDB_ID)
    assert titles == ["Other.Show.S05E26.CAT.1080p.WEB-DL.x264-TELEGRARR"]


@pytest.mark.asyncio
async def test_a_retitle_shows_in_the_activity_log(arr_app, fake_tmdb, arrs):
    await _connect(arr_app, fake_tmdb, arrs, EXAMPLE_SHOW, OTHER_SHOW)
    channel = await _mapped_channel(arr_app)
    await _publish(arr_app, channel, "Example Show 5x25 720p", "Example Show 5x26 1080p")

    await _map(arr_app, channel, OTHER_TMDB_ID)

    logs = (await arr_app.http.get("/api/logs", params={"channel_id": channel["id"]})).json()
    assert any(entry["level"] == "INFO" and "Retitled 2 releases" in entry["message"]
               and "Other Show (1979)" in entry["message"] for entry in logs)


@pytest.mark.asyncio
async def test_the_startup_refresh_leaves_movie_release_titles_alone(arr_app, fake_tmdb, arrs):
    from app import release_titles
    await _connect(arr_app, fake_tmdb, arrs, EXAMPLE_SHOW)
    fake_tmdb.add_movie(266856, titles={"ca-ES": "La teoria del tot",
                                        "en-US": "The Theory of Everything"},
                        release_date="2014-11-07", imdb_id="tt2980516")
    arr_app.telegram.add_channel(MOVIE_CHAT, "Pel·lícules")
    channel = await arr_app.add_channel(MOVIE_CHAT, kind="movie")
    arr_app.telegram.post(MOVIE_CHAT, text="La teoria del tot (2014)",
                          file_name="La.teoria.del.tot.2014.1080p.mkv")
    await arr_app.scan(channel["id"])

    await release_titles.refresh_all()

    r = await arr_app.http.get("/api/newznab", params={"t": "movie", "apikey": arr_app.apikey,
                                                       "tmdbid": "266856"})
    titles = [t.text for t in ET.fromstring(r.text).findall("./channel/item/title")]
    assert titles == ["The.Theory.of.Everything.2014.CAT.1080p.WEB-DL.x264-TELEGRARR"]
