"""Two-part episodes ("(2a Part)") are published under the episode number TVDB uses.

Driven over HTTP (``arr_app``); TMDB and Sonarr are faked at the httpx
transport level (``fake_tmdb``, ``arrs``).
"""
import re
import xml.etree.ElementTree as ET

import pytest

from fake_arr import SONARR_KEY
from fake_tmdb import API_KEY

SEASON_3_EPISODE = re.compile(r"\.S03E(\d+)\.")
CHAT = -1003333333333
TMDB_ID, TVDB_ID = 61662, 300001
SHOW = "Merlí"
PART_ONE = "3x13 Un viatge pel temps (1a Part)"
PART_TWO = "3x13 Un viatge pel temps (2a Part)"
SPLIT_SEASON = {
    12: {"ca-ES": "La paradoxa", "en-US": "The paradox"},
    13: {"ca-ES": "Un viatge pel temps (1)", "en-US": "A Journey Through Time (1)"},
    14: {"ca-ES": "Un viatge pel temps (2)", "en-US": "A Journey Through Time (2)"},
    15: {"ca-ES": "Final", "en-US": "Finale"},
}


async def _mapped_channel(arr_app, fake_tmdb) -> dict:
    fake_tmdb.add_series(TMDB_ID, titles={"ca-ES": SHOW}, tvdb_id=TVDB_ID)
    (await arr_app.http.patch("/api/settings", json={"tmdb_key": API_KEY})).raise_for_status()
    arr_app.telegram.add_channel(CHAT, SHOW)
    channel = await arr_app.add_channel(CHAT, kind="tv")
    r = await arr_app.http.put(f"/api/channels/{channel['id']}/series", json={"tmdb_id": TMDB_ID})
    return r.raise_for_status().json()


def _post(arr_app, text: str) -> None:
    arr_app.telegram.post(CHAT, text=text, file_name=f"{text}.mkv")


async def _episodes_on_feed(arr_app) -> list[int]:
    """Episode numbers of the season-3 release titles Sonarr sees."""
    r = await arr_app.http.get("/api/newznab", params={"t": "tvsearch", "apikey": arr_app.apikey,
                                                       "tvdbid": TVDB_ID, "season": 3})
    titles = [t.text for t in ET.fromstring(r.raise_for_status().text).findall("./channel/item/title")]
    return sorted(int(SEASON_3_EPISODE.search(t).group(1)) for t in titles)


@pytest.mark.asyncio
async def test_second_part_is_published_as_the_next_episode_when_metadata_splits_it(arr_app, fake_tmdb):
    channel = await _mapped_channel(arr_app, fake_tmdb)
    fake_tmdb.add_season(TMDB_ID, 3, SPLIT_SEASON)
    _post(arr_app, PART_ONE)
    _post(arr_app, PART_TWO)

    await arr_app.scan(channel["id"])

    assert await _episodes_on_feed(arr_app) == [13, 14]


@pytest.mark.asyncio
async def test_part_keeps_the_channel_episode_when_metadata_lists_a_single_episode(arr_app, fake_tmdb):
    channel = await _mapped_channel(arr_app, fake_tmdb)
    fake_tmdb.add_season(TMDB_ID, 3, {12: {"ca-ES": "La paradoxa"}, 13: {"ca-ES": "Un viatge pel temps"},
                                      14: {"ca-ES": "Final"}})
    _post(arr_app, PART_TWO)

    await arr_app.scan(channel["id"])

    assert await _episodes_on_feed(arr_app) == [13]


SEASON_3_PATH = f"/tv/{TMDB_ID}/season/3"


async def _connect_sonarr(arr_app, arrs, episodes: dict[int, str]) -> None:
    (await arr_app.http.patch("/api/settings", json={"sonarr_url": "http://sonarr.test:8989",
                                                     "sonarr_key": SONARR_KEY})).raise_for_status()
    arrs.sonarr.series.append({"id": 7, "tvdbId": TVDB_ID, "title": SHOW})
    arrs.sonarr.episodes.extend({"seriesId": 7, "seasonNumber": 3, "episodeNumber": n, "title": title}
                                for n, title in episodes.items())


def _sonarr_episode_requests(arrs) -> int:
    return sum(1 for r in arrs.sonarr.requests if r.url.path == "/api/v3/episode")


@pytest.mark.asyncio
async def test_catalan_metadata_is_used_first(arr_app, fake_tmdb, arrs):
    channel = await _mapped_channel(arr_app, fake_tmdb)
    fake_tmdb.add_season(TMDB_ID, 3, SPLIT_SEASON)
    await _connect_sonarr(arr_app, arrs, {13: "Un viatge pel temps (1)", 14: "Un viatge pel temps (2)"})
    _post(arr_app, PART_TWO)

    await arr_app.scan(channel["id"])

    assert await _episodes_on_feed(arr_app) == [14]
    assert fake_tmdb.season_requests() == [(SEASON_3_PATH, "ca-ES")]
    assert _sonarr_episode_requests(arrs) == 0


@pytest.mark.asyncio
async def test_english_metadata_is_tried_when_catalan_names_are_missing(arr_app, fake_tmdb, arrs):
    channel = await _mapped_channel(arr_app, fake_tmdb)
    fake_tmdb.add_season(TMDB_ID, 3, {13: {"en-US": "Un viatge pel temps (1)"},
                                      14: {"en-US": "Un viatge pel temps (2)"}})
    await _connect_sonarr(arr_app, arrs, {13: "Un viatge pel temps (1)", 14: "Un viatge pel temps (2)"})
    _post(arr_app, PART_TWO)

    await arr_app.scan(channel["id"])

    assert await _episodes_on_feed(arr_app) == [14]
    assert fake_tmdb.season_requests() == [(SEASON_3_PATH, "ca-ES"), (SEASON_3_PATH, "en-US")]
    assert _sonarr_episode_requests(arrs) == 0


@pytest.mark.asyncio
async def test_sonarr_is_tried_when_tmdb_has_no_match(arr_app, fake_tmdb, arrs):
    channel = await _mapped_channel(arr_app, fake_tmdb)
    fake_tmdb.add_season(TMDB_ID, 3, {13: {"en-US": "A Journey Through Time (1)"},
                                      14: {"en-US": "A Journey Through Time (2)"}})
    await _connect_sonarr(arr_app, arrs, {12: "La paradoxa", 13: "Un viatge pel temps, Part 1",
                                          14: "Un viatge pel temps, Part 2"})
    _post(arr_app, PART_TWO)

    await arr_app.scan(channel["id"])

    assert await _episodes_on_feed(arr_app) == [14]
    assert fake_tmdb.season_requests() == [(SEASON_3_PATH, "ca-ES"), (SEASON_3_PATH, "en-US")]
    assert _sonarr_episode_requests(arrs) == 1


@pytest.mark.asyncio
async def test_unmatched_part_keeps_the_channel_episode_and_logs_it(arr_app, fake_tmdb):
    channel = await _mapped_channel(arr_app, fake_tmdb)
    fake_tmdb.add_season(TMDB_ID, 3, {13: {"ca-ES": "Una altra cosa (1)"}, 14: {"ca-ES": "Una altra cosa (2)"}})
    _post(arr_app, PART_TWO)

    await arr_app.scan(channel["id"])

    assert await _episodes_on_feed(arr_app) == [13]
    logs = (await arr_app.http.get("/api/logs", params={"channel_id": channel["id"]})).json()
    assert any(entry["level"] == "WARN" and "Un viatge pel temps (2a Part)" in entry["message"]
               and "keeping channel numbering" in entry["message"] for entry in logs)


@pytest.mark.asyncio
async def test_download_row_shows_the_resolved_and_the_channel_episode(arr_app, fake_tmdb):
    channel = await _mapped_channel(arr_app, fake_tmdb)
    fake_tmdb.add_season(TMDB_ID, 3, SPLIT_SEASON)
    _post(arr_app, PART_TWO)
    await arr_app.scan(channel["id"])
    feed = (await arr_app.http.get("/api/newznab", params={"t": "tvsearch", "apikey": arr_app.apikey,
                                                           "tvdbid": TVDB_ID})).text
    nzb_url = ET.fromstring(feed).find("./channel/item/enclosure").attrib["url"]

    added = await arr_app.http.get("/sabnzbd/api", params={"apikey": arr_app.apikey, "output": "json",
                                                           "mode": "addurl", "name": nzb_url, "cat": "tv"})
    await arr_app.history_slot(added.json()["nzo_ids"][0])

    row = (await arr_app.http.get("/api/downloads")).json()[0]
    assert (row["season"], row["episode"], row["parsed_episode"], row["episode_source"]) == (3, 14, 13, "tmdb-ca")
