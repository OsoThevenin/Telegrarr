"""Directory channel mass import: scan a channel that posts links to per-series
channels, then import the ticked ones as mapped series channels.

Driven over HTTP (``arr_app``) with Telegram faked at the client
(``FakeTelegram``) and TMDB at the httpx transport (``fake_tmdb``).
"""
import pytest
from telethon.tl.functions.channels import JoinChannelRequest
from telethon.tl.functions.messages import ImportChatInviteRequest

from fake_tmdb import API_KEY

DIRECTORY = -1009000000001
MERLI = -1009000000002
JOC = -1009000000003
PRIVATE = -1009000000004


@pytest.fixture(autouse=True)
def _isolated_directory_scans(monkeypatch):
    """Resolutions are spaced out for account safety; tests don't wait for it.
    Scan results are kept per process; each test starts with none, and with an
    open FloodWait gate of its own."""
    from app import directory, downloader
    from app.safety import FloodGate

    monkeypatch.setattr(directory, "RESOLVE_INTERVAL_S", 0)
    monkeypatch.setattr(directory, "_cache", directory._Cache())
    monkeypatch.setattr(downloader, "flood_gate", FloodGate())


def _directory(arr_app):
    tg = arr_app.telegram
    tg.add_channel(DIRECTORY, "Sèries en català", username="series_cat")
    tg.add_channel(MERLI, "Merlí [CAT] 1080p", username="merli_cat")
    tg.add_channel(JOC, "Joc de trons CAT", username="jocdetrons_cat")
    return tg


async def _scan(arr_app, chat_id=DIRECTORY):
    r = await arr_app.http.post("/api/directory/scan", json={"chat_id": chat_id})
    assert r.status_code == 200, r.text
    return r.json()


def _by_link(scan):
    return {entry["link"]: entry for entry in scan["links"]}


@pytest.mark.asyncio
async def test_scan_lists_linked_public_channels_with_their_titles(arr_app):
    tg = _directory(arr_app)
    tg.post_text(DIRECTORY, "Merlí: https://t.me/merli_cat\nJoc de trons → t.me/jocdetrons_cat")

    scan = await _scan(arr_app)

    links = _by_link(scan)
    assert set(links) == {"https://t.me/merli_cat", "https://t.me/jocdetrons_cat"}
    assert (links["https://t.me/merli_cat"]["chat_id"], links["https://t.me/merli_cat"]["title"]) == \
        (MERLI, "Merlí [CAT] 1080p")
    assert links["https://t.me/jocdetrons_cat"]["resolved"] is True
    assert scan["directory"] == {"chat_id": DIRECTORY, "title": "Sèries en català"}


async def _save_tmdb_key(arr_app):
    (await arr_app.http.patch("/api/settings", json={"tmdb_key": API_KEY})).raise_for_status()


@pytest.mark.asyncio
async def test_scan_suggests_the_catalan_tmdb_match_for_each_channel(arr_app, fake_tmdb):
    fake_tmdb.add_series(61662, titles={"ca-ES": "Merlí"}, first_air_date="2015-09-14")
    fake_tmdb.add_series(1399, titles={"ca-ES": "Joc de trons", "en-US": "Game of Thrones"},
                         first_air_date="2011-04-17")
    await _save_tmdb_key(arr_app)
    tg = _directory(arr_app)
    tg.post_text(DIRECTORY, "https://t.me/merli_cat https://t.me/jocdetrons_cat")

    links = _by_link(await _scan(arr_app))

    merli, joc = links["https://t.me/merli_cat"]["suggestion"], links["https://t.me/jocdetrons_cat"]["suggestion"]
    assert (merli["tmdb_id"], merli["title"], merli["year"]) == (61662, "Merlí", "2015")
    assert (joc["tmdb_id"], joc["title"]) == (1399, "Joc de trons")
    assert ("Merlí", "ca-ES") in fake_tmdb.searches()


@pytest.mark.asyncio
async def test_scan_without_tmdb_key_still_lists_channels_and_says_a_key_is_needed(arr_app, fake_tmdb):
    tg = _directory(arr_app)
    tg.post_text(DIRECTORY, "https://t.me/merli_cat")

    scan = await _scan(arr_app)

    assert [(e["title"], e["suggestion"]) for e in scan["links"]] == [("Merlí [CAT] 1080p", None)]
    assert scan["tmdb_error"]["key"] == "err.tmdb.key_missing"
    assert fake_tmdb.requests == []


@pytest.mark.asyncio
async def test_scan_marks_channels_that_are_already_added(arr_app):
    tg = _directory(arr_app)
    tg.post_text(DIRECTORY, "https://t.me/merli_cat https://t.me/jocdetrons_cat")
    existing = await arr_app.add_channel(MERLI)

    links = _by_link(await _scan(arr_app))

    assert (links["https://t.me/merli_cat"]["already_added"], links["https://t.me/merli_cat"]["channel_id"]) == \
        (True, existing["id"])
    assert links["https://t.me/jocdetrons_cat"]["already_added"] is False


@pytest.mark.asyncio
async def test_invite_links_resolve_only_for_joined_channels_and_never_join(arr_app):
    tg = _directory(arr_app)
    tg.add_channel(PRIVATE, "Sèrie privada CAT")
    tg.add_invite("JoinedInviteHash01", chat_id=PRIVATE)
    tg.add_invite("StrangerInviteHash", title="Unknown private channel")
    tg.post_text(DIRECTORY, "https://t.me/+JoinedInviteHash01 i https://t.me/joinchat/StrangerInviteHash")

    links = _by_link(await _scan(arr_app))

    joined = links["https://t.me/+JoinedInviteHash01"]
    assert (joined["resolved"], joined["chat_id"], joined["title"]) == (True, PRIVATE, "Sèrie privada CAT")
    stranger = links["https://t.me/+StrangerInviteHash"]
    assert stranger["resolved"] is False and stranger["chat_id"] is None
    assert stranger["error"]["key"] == "err.directory.not_a_member"
    assert not any(isinstance(r, (JoinChannelRequest, ImportChatInviteRequest)) for r in tg.requests)


@pytest.mark.asyncio
async def test_scan_finds_links_in_hidden_text_links_and_buttons_once_each(arr_app):
    tg = _directory(arr_app)
    tg.post_text(DIRECTORY, "Merlí", urls=("https://t.me/merli_cat",))
    tg.post_text(DIRECTORY, "Joc de trons", buttons=("https://t.me/jocdetrons_cat/12",))
    tg.post_text(DIRECTORY, "Again t.me/merli_cat · share: https://t.me/share/url?url=x · @someone · "
                            "https://t.me/addstickers/Pack")

    scan = await _scan(arr_app)

    assert sorted(e["link"] for e in scan["links"]) == ["https://t.me/jocdetrons_cat", "https://t.me/merli_cat"]


@pytest.mark.asyncio
async def test_the_directory_linking_to_itself_is_not_listed(arr_app):
    tg = _directory(arr_app)
    tg.post_text(DIRECTORY, "Comparteix: https://t.me/series_cat · Merlí: https://t.me/merli_cat")

    scan = await _scan(arr_app)

    assert [e["link"] for e in scan["links"]] == ["https://t.me/merli_cat"]


@pytest.mark.asyncio
async def test_unknown_usernames_are_reported_as_unresolvable(arr_app):
    tg = _directory(arr_app)
    tg.post_text(DIRECTORY, "https://t.me/gone_channel")

    [entry] = (await _scan(arr_app))["links"]

    assert (entry["link"], entry["resolved"], entry["chat_id"]) == ("https://t.me/gone_channel", False, None)
    assert entry["error"]


# ── account safety ───────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_scan_reads_a_bounded_number_of_messages_and_caps_resolutions(arr_app, monkeypatch):
    from app import directory

    monkeypatch.setattr(directory, "SCAN_MESSAGE_LIMIT", 3)
    monkeypatch.setattr(directory, "MAX_LINKS_PER_SCAN", 1)
    tg = _directory(arr_app)
    tg.post_text(DIRECTORY, "too old to be read: https://t.me/old_channel")
    tg.post_text(DIRECTORY, "https://t.me/jocdetrons_cat")
    tg.post_text(DIRECTORY, "https://t.me/merli_cat")
    tg.post_text(DIRECTORY, "nothing here")

    scan = await _scan(arr_app)

    assert scan["messages_scanned"] == 3
    assert [(e["link"], e["resolved"]) for e in scan["links"]] == [
        ("https://t.me/merli_cat", True), ("https://t.me/jocdetrons_cat", False)]
    assert "jocdetrons_cat" not in tg.lookups


@pytest.mark.asyncio
async def test_a_floodwait_mid_scan_stops_resolving_and_closes_the_gate(arr_app):
    tg = _directory(arr_app)
    tg.post_text(DIRECTORY, "https://t.me/merli_cat https://t.me/jocdetrons_cat https://t.me/third_one")
    tg.flood_after_lookups = 2          # the directory itself + merli_cat succeed

    scan = await _scan(arr_app)

    assert [(e["link"], e["resolved"]) for e in scan["links"]] == [
        ("https://t.me/merli_cat", True), ("https://t.me/jocdetrons_cat", False), ("https://t.me/third_one", False)]
    assert scan["links"][1]["error"]["key"] == "err.directory.rate_limited"
    assert tg.lookups[-1] == "jocdetrons_cat"        # nothing tried after the FloodWait

    again = await arr_app.http.post("/api/directory/scan", json={"chat_id": DIRECTORY})

    assert again.status_code == 429
    assert again.json()["detail"]["key"] == "err.directory.rate_limit_active"
    assert len(tg.history_reads) == 1


@pytest.mark.asyncio
async def test_rescanning_within_the_poll_floor_reuses_the_last_read(arr_app):
    tg = _directory(arr_app)
    tg.post_text(DIRECTORY, "https://t.me/merli_cat")
    await _scan(arr_app)
    await arr_app.add_channel(MERLI)
    lookups_before = len(tg.lookups)

    again = await _scan(arr_app)

    assert again["cached"] is True
    assert again["next_scan_at"] - again["scanned_at"] >= 15 * 60
    assert tg.history_reads == [DIRECTORY]
    assert len(tg.lookups) == lookups_before            # no Telegram lookups at all
    assert again["links"][0]["already_added"] is True    # marks reflect the current channel list


# ── import ───────────────────────────────────────────────────────────
async def _import(arr_app, *items):
    r = await arr_app.http.post("/api/directory/import", json={"channels": list(items)})
    assert r.status_code == 200, r.text
    return {res["chat_id"]: res for res in r.json()["results"]}


async def _channels(arr_app):
    return {c["chat_id"]: c for c in (await arr_app.http.get("/api/channels")).json()}


@pytest.mark.asyncio
async def test_import_creates_mapped_series_channels_with_derived_ids(arr_app, fake_tmdb):
    fake_tmdb.add_series(61662, titles={"ca-ES": "Merlí"}, tvdb_id=297571, imdb_id="tt4807092")
    fake_tmdb.add_series(1399, titles={"ca-ES": "Joc de trons"}, tvdb_id=121361, imdb_id="tt0944947")
    await _save_tmdb_key(arr_app)

    results = await _import(
        arr_app,
        {"chat_id": MERLI, "title": "Merlí [CAT] 1080p", "tmdb_id": 61662, "series_title": "Merlí (2015)"},
        {"chat_id": JOC, "title": "Joc de trons CAT", "tmdb_id": 1399, "tvdb_id": "999999"})

    assert {k: v["status"] for k, v in results.items()} == {MERLI: "added", JOC: "added"}
    stored = await _channels(arr_app)
    merli, joc = stored[MERLI], stored[JOC]
    assert (merli["kind"], merli["title"], merli["imdb_title"]) == ("tv", "Merlí [CAT] 1080p", "Merlí (2015)")
    assert (merli["tvdb_id"], merli["tmdb_id"], merli["imdb_id"]) == (297571, 61662, "tt4807092")
    assert (joc["tvdb_id"], joc["tmdb_id"]) == (999999, 1399)        # a typed TVDB id wins, as in mapping
    assert merli["poll_minutes"] >= 15


@pytest.mark.asyncio
async def test_import_skips_channels_that_are_already_added(arr_app, fake_tmdb):
    fake_tmdb.add_series(61662, titles={"ca-ES": "Merlí"}, tvdb_id=297571)
    await _save_tmdb_key(arr_app)
    _directory(arr_app)
    existing = await arr_app.add_channel(MERLI, poll_minutes=60)

    results = await _import(arr_app, {"chat_id": MERLI, "title": "Merlí", "tmdb_id": 61662},
                            {"chat_id": MERLI, "title": "Merlí", "tmdb_id": 61662})

    assert (results[MERLI]["status"], results[MERLI]["channel_id"]) == ("skipped", existing["id"])
    stored = (await _channels(arr_app))[MERLI]
    assert (stored["poll_minutes"], stored["tvdb_id"]) == (60, None)     # left exactly as it was
    assert fake_tmdb.requests == []


@pytest.mark.asyncio
async def test_import_does_not_create_a_channel_whose_ids_cannot_be_derived(arr_app, fake_tmdb):
    fake_tmdb.add_series(5000, titles={"ca-ES": "Sèrie local"}, tvdb_id=None)
    fake_tmdb.add_series(61662, titles={"ca-ES": "Merlí"}, tvdb_id=297571)
    await _save_tmdb_key(arr_app)

    results = await _import(arr_app, {"chat_id": PRIVATE, "title": "Sèrie local", "tmdb_id": 5000},
                            {"chat_id": MERLI, "title": "Merlí", "tmdb_id": 61662})

    assert results[PRIVATE]["status"] == "failed"
    assert results[PRIVATE]["detail"]["key"] == "err.tmdb.series_without_tvdb"
    assert results[MERLI]["status"] == "added"
    assert set(await _channels(arr_app)) == {MERLI}


@pytest.mark.asyncio
async def test_import_without_a_match_adds_an_unmapped_series_channel(arr_app, fake_tmdb):
    results = await _import(arr_app, {"chat_id": MERLI, "title": "Merlí [CAT]"})

    assert results[MERLI]["status"] == "added"
    stored = (await _channels(arr_app))[MERLI]
    assert (stored["kind"], stored["tvdb_id"]) == ("tv", None)


@pytest.mark.asyncio
@pytest.mark.parametrize("body", [{}, {"channels": []}, {"channels": "x"}, {"channels": ["x"]},
                                  {"channels": [{"chat_id": "abc"}]}])
async def test_import_rejects_malformed_requests(arr_app, body):
    r = await arr_app.http.post("/api/directory/import", json=body)

    assert r.status_code == 400
    assert await _channels(arr_app) == {}


@pytest.mark.asyncio
async def test_scan_then_import_round_trip_marks_imported_channels(arr_app, fake_tmdb):
    fake_tmdb.add_series(61662, titles={"ca-ES": "Merlí"}, tvdb_id=297571, first_air_date="2015-09-14")
    await _save_tmdb_key(arr_app)
    tg = _directory(arr_app)
    tg.post_text(DIRECTORY, "https://t.me/merli_cat")
    [entry] = (await _scan(arr_app))["links"]

    await _import(arr_app, {"chat_id": entry["chat_id"], "title": entry["title"],
                            "tmdb_id": entry["suggestion"]["tmdb_id"]})
    [rescanned] = (await _scan(arr_app))["links"]

    assert rescanned["already_added"] is True
    assert (await _channels(arr_app))[MERLI]["imdb_title"] == "Merlí"
