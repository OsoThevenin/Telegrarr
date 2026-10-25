"""Series channels are mapped to TVDB/TMDB/IMDb ids, and Sonarr finds releases by id.

Driven over HTTP (``arr_app``) with TMDB faked at the httpx transport level
(``fake_tmdb``).
"""
import xml.etree.ElementTree as ET

import pytest

from fake_tmdb import API_KEY

NEWZNAB_NS = "{http://www.newznab.com/DTD/2010/feeds/attributes/}"
SHOW_CHAT = -1001111111111
OTHER_CHAT = -1002222222222


def _supported_params(caps: str, element: str) -> set[str]:
    node = ET.fromstring(caps).find(f"./searching/{element}")
    return set(node.attrib["supportedParams"].split(","))


@pytest.mark.asyncio
async def test_caps_advertise_tvdb_tmdb_and_imdb_ids(arr_app):
    caps = (await arr_app.http.get("/api/newznab", params={"t": "caps"})).text

    assert {"tvdbid", "tmdbid", "imdbid"} <= _supported_params(caps, "tv-search")
    assert {"tmdbid", "imdbid"} <= _supported_params(caps, "movie-search")


async def _save_tmdb_key(arr_app, key=API_KEY):
    (await arr_app.http.patch("/api/settings", json={"tmdb_key": key})).raise_for_status()


@pytest.mark.asyncio
async def test_tmdb_search_finds_series_by_catalan_title(arr_app, fake_tmdb):
    fake_tmdb.add_series(61662, titles={"ca-ES": "Merlí", "en-US": "Merlí"}, first_air_date="2015-09-14")
    fake_tmdb.add_series(1399, titles={"ca-ES": "Joc de trons", "en-US": "Game of Thrones"},
                         first_air_date="2011-04-17")
    await _save_tmdb_key(arr_app)

    r = await arr_app.http.get("/api/tmdb/search", params={"q": "joc de trons"})

    assert r.status_code == 200
    hits = r.json()
    assert [(h["tmdb_id"], h["title"], h["year"]) for h in hits] == [(1399, "Joc de trons", "2011")]
    assert fake_tmdb.searches() == [("joc de trons", "ca-ES")]


@pytest.mark.asyncio
async def test_tmdb_search_falls_back_to_english_when_catalan_finds_nothing(arr_app, fake_tmdb):
    fake_tmdb.add_series(1396, titles={"en-US": "Breaking Bad"}, first_air_date="2008-01-20")
    await _save_tmdb_key(arr_app)

    r = await arr_app.http.get("/api/tmdb/search", params={"q": "breaking bad"})

    assert [(h["tmdb_id"], h["title"]) for h in r.json()] == [(1396, "Breaking Bad")]
    assert fake_tmdb.searches() == [("breaking bad", "ca-ES"), ("breaking bad", "en-US")]


@pytest.mark.asyncio
async def test_tmdb_search_without_key_says_a_key_is_required(arr_app, fake_tmdb):
    r = await arr_app.http.get("/api/tmdb/search", params={"q": "merlí"})

    assert r.status_code == 400
    assert r.json()["detail"]["key"] == "err.tmdb.key_missing"
    assert fake_tmdb.requests == []


@pytest.mark.asyncio
async def test_tmdb_connection_test_without_key_reports_it_is_required(arr_app, fake_tmdb):
    r = await arr_app.http.post("/api/integrations/tmdb/test", json={})

    assert r.json()["ok"] is False
    assert r.json()["detail"]["key"] == "tmdb.test.no_key"


@pytest.mark.asyncio
async def test_tmdb_connection_test_accepts_a_valid_key(arr_app, fake_tmdb):
    r = await arr_app.http.post("/api/integrations/tmdb/test", json={"key": API_KEY})

    assert r.json()["ok"] is True


async def _series_channel(arr_app, chat_id=SHOW_CHAT, title="Joc de trons CAT"):
    arr_app.telegram.add_channel(chat_id, title)
    return await arr_app.add_channel(chat_id, kind="tv")


@pytest.mark.asyncio
async def test_mapping_a_picked_tmdb_series_stores_tvdb_tmdb_and_imdb_ids(arr_app, fake_tmdb):
    fake_tmdb.add_series(1399, titles={"ca-ES": "Joc de trons", "en-US": "Game of Thrones"},
                         tvdb_id=121361, imdb_id="tt0944947")
    await _save_tmdb_key(arr_app)
    channel = await _series_channel(arr_app)

    r = await arr_app.http.put(f"/api/channels/{channel['id']}/series",
                               json={"tmdb_id": 1399, "title": "Joc de trons (2011)"})

    assert r.status_code == 200
    stored = next(c for c in (await arr_app.http.get("/api/channels")).json() if c["id"] == channel["id"])
    assert (stored["tvdb_id"], stored["tmdb_id"], stored["imdb_id"]) == (121361, 1399, "tt0944947")
    assert stored["imdb_title"] == "Joc de trons (2011)"


@pytest.mark.asyncio
async def test_an_edited_tvdb_id_wins_over_the_derived_one(arr_app, fake_tmdb):
    fake_tmdb.add_series(1399, titles={"en-US": "Game of Thrones"}, tvdb_id=121361, imdb_id="tt0944947")
    await _save_tmdb_key(arr_app)
    channel = await _series_channel(arr_app)

    r = await arr_app.http.put(f"/api/channels/{channel['id']}/series",
                               json={"tmdb_id": 1399, "tvdb_id": "999999", "title": "Game of Thrones"})

    assert (r.json()["tvdb_id"], r.json()["tmdb_id"]) == (999999, 1399)


@pytest.mark.asyncio
async def test_a_typed_tvdb_id_alone_derives_tmdb_and_imdb_ids(arr_app, fake_tmdb):
    fake_tmdb.add_series(1399, titles={"en-US": "Game of Thrones"}, tvdb_id=121361, imdb_id="tt0944947")
    await _save_tmdb_key(arr_app)
    channel = await _series_channel(arr_app)

    r = await arr_app.http.put(f"/api/channels/{channel['id']}/series", json={"tvdb_id": 121361})

    body = r.json()
    assert (body["tvdb_id"], body["tmdb_id"], body["imdb_id"]) == (121361, 1399, "tt0944947")
    assert body["imdb_title"] == "Game of Thrones"


@pytest.mark.asyncio
async def test_mapping_without_tmdb_key_is_blocked_with_a_clear_message(arr_app, fake_tmdb):
    channel = await _series_channel(arr_app)

    r = await arr_app.http.put(f"/api/channels/{channel['id']}/series", json={"tmdb_id": 1399})

    assert r.status_code == 400
    assert r.json()["detail"]["key"] == "err.tmdb.key_missing"
    stored = next(c for c in (await arr_app.http.get("/api/channels")).json() if c["id"] == channel["id"])
    assert stored["tvdb_id"] is None


@pytest.mark.asyncio
async def test_mapping_a_series_tmdb_has_no_tvdb_id_for_asks_for_one(arr_app, fake_tmdb):
    fake_tmdb.add_series(5000, titles={"ca-ES": "Sèrie local"}, tvdb_id=None, imdb_id=None)
    await _save_tmdb_key(arr_app)
    channel = await _series_channel(arr_app)

    r = await arr_app.http.put(f"/api/channels/{channel['id']}/series", json={"tmdb_id": 5000})

    assert r.status_code == 400
    assert r.json()["detail"]["key"] == "err.tmdb.series_without_tvdb"


async def _two_mapped_series(arr_app, fake_tmdb):
    """Joc de trons on SHOW_CHAT and Merlí on OTHER_CHAT, both scanned with one episode."""
    fake_tmdb.add_series(1399, titles={"ca-ES": "Joc de trons"}, tvdb_id=121361, imdb_id="tt0944947")
    fake_tmdb.add_series(61662, titles={"ca-ES": "Merlí"}, tvdb_id=297571, imdb_id="tt4807092")
    await _save_tmdb_key(arr_app)
    channels = {}
    for chat_id, tmdb_id, name in ((SHOW_CHAT, 1399, "Joc de trons"), (OTHER_CHAT, 61662, "Merlí")):
        channel = await _series_channel(arr_app, chat_id, f"{name} CAT")
        arr_app.telegram.post(chat_id, text=f"{name} 1x02", file_name=f"{name}.S01E02.1080p.mkv")
        (await arr_app.http.put(f"/api/channels/{channel['id']}/series",
                                json={"tmdb_id": tmdb_id, "title": name})).raise_for_status()
        await arr_app.scan(channel["id"])
        channels[name] = channel
    return channels


def _items(feed: str) -> list[ET.Element]:
    return ET.fromstring(feed).findall("./channel/item")


def _attrs(item: ET.Element) -> dict[str, str]:
    return {a.attrib["name"]: a.attrib["value"] for a in item.findall(f"{NEWZNAB_NS}attr")}


@pytest.mark.asyncio
@pytest.mark.parametrize("id_param", [
    {"tvdbid": "121361"},
    {"tmdbid": "1399"},
    {"imdbid": "0944947"},
    {"imdbid": "tt0944947"},
])
async def test_tvsearch_by_id_returns_only_that_series_releases(arr_app, fake_tmdb, id_param):
    channels = await _two_mapped_series(arr_app, fake_tmdb)

    r = await arr_app.http.get("/api/newznab", params={
        "t": "tvsearch", "apikey": arr_app.apikey, "season": "1", "ep": "2", **id_param})

    assert r.status_code == 200
    items = _items(r.text)
    assert len(items) == 1
    assert f"telearr-{channels['Joc de trons']['id']}-" in items[0].find("guid").text


@pytest.mark.asyncio
async def test_tvsearch_by_an_unknown_tvdb_id_returns_nothing(arr_app, fake_tmdb):
    await _two_mapped_series(arr_app, fake_tmdb)

    r = await arr_app.http.get("/api/newznab", params={"t": "tvsearch", "apikey": arr_app.apikey,
                                                         "tvdbid": "1"})

    assert _items(r.text) == []


@pytest.mark.asyncio
async def test_feed_items_carry_the_series_ids(arr_app, fake_tmdb):
    await _two_mapped_series(arr_app, fake_tmdb)

    r = await arr_app.http.get("/api/newznab", params={"t": "tvsearch", "apikey": arr_app.apikey,
                                                         "tvdbid": "297571"})

    attrs = _attrs(_items(r.text)[0])
    assert (attrs["tvdbid"], attrs["tmdbid"], attrs["imdb"]) == ("297571", "61662", "4807092")
