"""TV Releases carry Sonarr's own series title, so Sonarr matches a Grab by name.

The series year in a TMDB-derived title can differ from Sonarr's (TVDB's), and
Sonarr's year match is exact: a mismatch makes the Grab fall back to an id match,
which blocks automatic import. Driven over HTTP (``arr_app``) with TMDB and
Sonarr faked at the httpx transport level (``fake_tmdb``, ``arrs``).
"""
import re
import unicodedata
import xml.etree.ElementTree as ET

import pytest

from fake_arr import SONARR_KEY
from fake_tmdb import API_KEY

CHAT = -1009400000001
MOVIE_CHAT = -1009400000002
TMDB_ID, TVDB_ID = 94001, 394001
EPISODE_TAG = re.compile(r"\.S\d{2}E\d{2}")

# A series TMDB dates 2002 and Sonarr (TVDB) dates 2001, titled differently.
EXAMPLE_SHOW = {"id": 11, "tvdbId": TVDB_ID, "title": "Example Show!", "year": 2001,
                "cleanTitle": "exampleshow"}
# A series whose Sonarr title carries its year.
OLD_SHOW = {"id": 12, "tvdbId": TVDB_ID, "title": "Old Show (1979)", "year": 1979,
            "cleanTitle": "oldshow1979"}


async def _connect_sonarr(arr_app, arrs, *series: dict) -> None:
    (await arr_app.http.patch("/api/settings", json={"sonarr_url": "http://sonarr.test:8989",
                                                     "sonarr_key": SONARR_KEY})).raise_for_status()
    arrs.sonarr.series.extend(series)


async def _mapped_channel(arr_app, fake_tmdb, *, tmdb_title: str = "Example Show",
                          first_air_date: str = "2002-03-01", display_title: str = "") -> dict:
    fake_tmdb.add_series(TMDB_ID, titles={"en-US": tmdb_title}, tvdb_id=TVDB_ID,
                         first_air_date=first_air_date)
    (await arr_app.http.patch("/api/settings", json={"tmdb_key": API_KEY})).raise_for_status()
    arr_app.telegram.add_channel(CHAT, f"{tmdb_title} CAT")
    channel = await arr_app.add_channel(CHAT, kind="tv")
    body = {"tmdb_id": TMDB_ID, **({"title": display_title} if display_title else {})}
    r = await arr_app.http.put(f"/api/channels/{channel['id']}/series", json=body)
    return r.raise_for_status().json()


async def _publish(arr_app, channel: dict, text: str) -> None:
    arr_app.telegram.post(CHAT, text=text, file_name=f"{text}.mkv")
    await arr_app.scan(channel["id"])


async def _tv_titles(arr_app) -> list[str]:
    """Release titles a tvsearch by TVDB id returns, as Sonarr sees them."""
    r = await arr_app.http.get("/api/newznab", params={"t": "tvsearch", "apikey": arr_app.apikey,
                                                       "tvdbid": TVDB_ID})
    return [t.text for t in ET.fromstring(r.raise_for_status().text).findall("./channel/item/title")]


@pytest.mark.asyncio
async def test_release_title_uses_sonarr_title_not_the_tmdb_year(arr_app, fake_tmdb, arrs):
    await _connect_sonarr(arr_app, arrs, EXAMPLE_SHOW)
    channel = await _mapped_channel(arr_app, fake_tmdb)

    await _publish(arr_app, channel, "Example Show 5x26 1080p")

    assert await _tv_titles(arr_app) == ["Example.Show.S05E26.CAT.1080p.WEB-DL.x264-TELEGRARR"]


@pytest.mark.asyncio
async def test_a_year_in_sonarr_title_goes_into_the_release_title(arr_app, fake_tmdb, arrs):
    await _connect_sonarr(arr_app, arrs, OLD_SHOW)
    channel = await _mapped_channel(arr_app, fake_tmdb, tmdb_title="Old Show", first_air_date="1979-01-07")

    await _publish(arr_app, channel, "Old Show 1x07 1080p")

    assert await _tv_titles(arr_app) == ["Old.Show.1979.S01E07.CAT.1080p.WEB-DL.x264-TELEGRARR"]


@pytest.mark.asyncio
async def test_a_catalan_display_title_with_a_year_gives_way_to_sonarr_title(arr_app, fake_tmdb, arrs):
    await _connect_sonarr(arr_app, arrs, {**EXAMPLE_SHOW, "title": "Catalan Show", "cleanTitle": "catalanshow"})
    channel = await _mapped_channel(arr_app, fake_tmdb, tmdb_title="Catalan Show", first_air_date="2011-04-17",
                                    display_title="Títol Català (2011)")

    await _publish(arr_app, channel, "Títol Català 1x02 1080p")

    assert await _tv_titles(arr_app) == ["Catalan.Show.S01E02.CAT.1080p.WEB-DL.x264-TELEGRARR"]


@pytest.mark.asyncio
@pytest.mark.parametrize("sonarr", ["down", "series missing", "not configured"])
async def test_without_a_sonarr_title_the_mapped_title_is_used_with_no_year(arr_app, fake_tmdb, arrs, sonarr):
    if sonarr != "not configured":
        await _connect_sonarr(arr_app, arrs)
    if sonarr == "down":
        arrs.sonarr.fail_status = 503
    channel = await _mapped_channel(arr_app, fake_tmdb, display_title="Example Show")

    await _publish(arr_app, channel, "Example Show 5x26 1080p")

    assert await _tv_titles(arr_app) == ["Example.Show.S05E26.CAT.1080p.WEB-DL.x264-TELEGRARR"]


def _series_lookups(arrs) -> int:
    return sum(1 for r in arrs.sonarr.requests if r.url.path == "/api/v3/series")


@pytest.mark.asyncio
async def test_repeated_scans_ask_sonarr_for_the_title_once(arr_app, fake_tmdb, arrs):
    await _connect_sonarr(arr_app, arrs, EXAMPLE_SHOW)
    channel = await _mapped_channel(arr_app, fake_tmdb)

    await _publish(arr_app, channel, "Example Show 5x25 1080p")
    await _publish(arr_app, channel, "Example Show 5x26 1080p")

    assert sorted(await _tv_titles(arr_app)) == ["Example.Show.S05E25.CAT.1080p.WEB-DL.x264-TELEGRARR",
                                                 "Example.Show.S05E26.CAT.1080p.WEB-DL.x264-TELEGRARR"]
    assert _series_lookups(arrs) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("sonarr", ["down", "series missing"])
async def test_a_scan_asks_an_unhelpful_sonarr_once_not_per_release(arr_app, fake_tmdb, arrs, sonarr):
    await _connect_sonarr(arr_app, arrs)
    if sonarr == "down":
        arrs.sonarr.fail_status = 503
    channel = await _mapped_channel(arr_app, fake_tmdb, display_title="Example Show")
    for ep in (24, 25, 26):
        arr_app.telegram.post(CHAT, text=f"Example Show 5x{ep} 1080p", file_name=f"Example.Show.5x{ep}.mkv")

    await arr_app.scan(channel["id"])

    assert len(await _tv_titles(arr_app)) == 3
    assert _series_lookups(arrs) == 1


@pytest.mark.asyncio
async def test_remapping_the_channel_refreshes_the_sonarr_title(arr_app, fake_tmdb, arrs):
    await _connect_sonarr(arr_app, arrs, EXAMPLE_SHOW)
    channel = await _mapped_channel(arr_app, fake_tmdb)
    await _publish(arr_app, channel, "Example Show 5x25 1080p")
    arrs.sonarr.series[:] = [{**EXAMPLE_SHOW, "title": "Example Show (2001)", "cleanTitle": "exampleshow2001"}]

    (await arr_app.http.put(f"/api/channels/{channel['id']}/series",
                            json={"tmdb_id": TMDB_ID})).raise_for_status()
    await _publish(arr_app, channel, "Example Show 5x26 1080p")

    assert "Example.Show.2001.S05E26.CAT.1080p.WEB-DL.x264-TELEGRARR" in await _tv_titles(arr_app)


@pytest.mark.asyncio
async def test_movie_release_titles_are_unchanged(arr_app, fake_tmdb, arrs):
    await _connect_sonarr(arr_app, arrs, EXAMPLE_SHOW)
    fake_tmdb.add_movie(266856, titles={"ca-ES": "La teoria del tot", "en-US": "The Theory of Everything"},
                        release_date="2014-11-07", imdb_id="tt2980516")
    (await arr_app.http.patch("/api/settings", json={"tmdb_key": API_KEY})).raise_for_status()
    arr_app.telegram.add_channel(MOVIE_CHAT, "Pel·lícules")
    channel = await arr_app.add_channel(MOVIE_CHAT, kind="movie")
    arr_app.telegram.post(MOVIE_CHAT, text="La teoria del tot (2014)", file_name="La.teoria.del.tot.2014.1080p.mkv")

    await arr_app.scan(channel["id"])

    r = await arr_app.http.get("/api/newznab", params={"t": "movie", "apikey": arr_app.apikey, "tmdbid": "266856"})
    titles = [t.text for t in ET.fromstring(r.text).findall("./channel/item/title")]
    assert titles == ["The.Theory.of.Everything.2014.CAT.1080p.WEB-DL.x264-TELEGRARR"]
    assert _series_lookups(arrs) == 0


# ── invariant: Sonarr cleans the Release's series part to its own cleanTitle ──
# A port of Sonarr's Parser.CleanSeriesTitle (NzbDrone.Core/Parser/Parser.cs).
_SONARR_PERCENT = re.compile(r"(\b\d+)%")
_SONARR_NORMALIZE = re.compile(r"((?:\b|_)(?<!^)(a(?!$)|an|the|and|or|of)(?!$)(?:\b|_))|\W|_", re.IGNORECASE)


def sonarr_clean_series_title(title: str) -> str:
    if re.fullmatch(r"-?\d+", title):
        return title
    title = _SONARR_PERCENT.sub(r"\1percent", title)
    cleaned = _SONARR_NORMALIZE.sub("", title).lower()
    return "".join(ch for ch in unicodedata.normalize("NFD", cleaned) if not unicodedata.combining(ch))


@pytest.mark.asyncio
@pytest.mark.parametrize("series", [
    EXAMPLE_SHOW,
    OLD_SHOW,
    {"id": 13, "tvdbId": TVDB_ID, "title": "Merlí: Sapere Aude", "cleanTitle": "merlisapereaude"},
    {"id": 14, "tvdbId": TVDB_ID, "title": "Grey's Anatomy", "cleanTitle": "greysanatomy"},
], ids=lambda s: s["title"])
async def test_sonarr_cleans_the_release_series_part_to_its_clean_title(arr_app, fake_tmdb, arrs, series):
    await _connect_sonarr(arr_app, arrs, series)
    channel = await _mapped_channel(arr_app, fake_tmdb, tmdb_title="Some Other TMDB Title")

    await _publish(arr_app, channel, "Episodi 2x03 1080p")

    [title] = await _tv_titles(arr_app)
    series_part = EPISODE_TAG.split(title)[0].replace(".", " ")
    assert sonarr_clean_series_title(series_part) == series["cleanTitle"]


@pytest.mark.asyncio
async def test_an_unmapped_channel_is_named_after_the_channel_title(arr_app, arrs):
    await _connect_sonarr(arr_app, arrs, EXAMPLE_SHOW)
    arr_app.telegram.add_channel(CHAT, "La Sèrie")
    channel = await arr_app.add_channel(CHAT, kind="tv")

    await _publish(arr_app, channel, "La Sèrie 1x01 1080p")

    r = await arr_app.http.get("/api/newznab", params={"t": "tvsearch", "apikey": arr_app.apikey, "q": "sèrie"})
    titles = [t.text for t in ET.fromstring(r.text).findall("./channel/item/title")]
    assert titles == ["La.Sèrie.S01E01.CAT.1080p.WEB-DL.x264-TELEGRARR"]
