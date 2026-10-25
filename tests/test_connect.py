"""Connect page: Prowlarr/Sonarr/Radarr settings, connection tests and one-click
registration, driven over HTTP against fake *arr servers (tests/fake_arr.py)."""
import pytest

PROWLARR_KEY = "prowlarr-secret-key"
SONARR_KEY = "sonarr-secret-key"
RADARR_KEY = "radarr-secret-key"

ARR_SETTINGS = {
    "prowlarr_url": "http://prowlarr.test:9696/",
    "prowlarr_key": PROWLARR_KEY,
    "sonarr_url": "http://sonarr.test:8989",
    "sonarr_key": SONARR_KEY,
    "radarr_url": "http://radarr.test:7878",
    "radarr_key": RADARR_KEY,
    "telegrarr_url": "http://telegrarr:8790/",
}


@pytest.mark.asyncio
async def test_arr_urls_persist_and_keys_are_never_echoed(arr_app):
    r = await arr_app.http.patch("/api/settings", json=ARR_SETTINGS)

    assert r.status_code == 200
    got = (await arr_app.http.get("/api/settings")).json()
    s = got["settings"]
    assert s["prowlarr_url"] == "http://prowlarr.test:9696"
    assert s["sonarr_url"] == "http://sonarr.test:8989"
    assert s["radarr_url"] == "http://radarr.test:7878"
    assert s["telegrarr_url"] == "http://telegrarr:8790"
    assert s["prowlarr_key_set"] and s["sonarr_key_set"] and s["radarr_key_set"]
    for key in (PROWLARR_KEY, SONARR_KEY, RADARR_KEY):
        assert key not in r.text
        assert key not in str(got)


@pytest.mark.asyncio
async def test_non_http_arr_url_is_rejected(arr_app):
    await arr_app.http.patch("/api/settings", json={"sonarr_url": "javascript:alert(1)"})

    s = (await arr_app.http.get("/api/settings")).json()["settings"]
    assert s["sonarr_url"] == ""


@pytest.fixture()
def arrs(monkeypatch):
    """Fake Prowlarr/Sonarr/Radarr wired in as the app's outbound HTTP transport."""
    from app import connect
    from fake_arr import make_stack

    stack = make_stack(PROWLARR_KEY, SONARR_KEY, RADARR_KEY)
    monkeypatch.setattr(connect, "transport", stack.transport())
    return stack


@pytest.mark.asyncio
@pytest.mark.parametrize("app, version", [("prowlarr", "1.37.0.5076"), ("sonarr", "4.0.19.2979"),
                                          ("radarr", "6.3.0.10170")])
async def test_connection_test_reports_version(arr_app, arrs, app, version):
    await arr_app.http.patch("/api/settings", json=ARR_SETTINGS)

    r = await arr_app.http.post("/api/connect/test", json={"app": app})

    assert r.status_code == 200
    assert r.json() == {"app": app, "ok": True, "version": version}


@pytest.mark.asyncio
async def test_connection_test_reports_wrong_key_without_echoing_it(arr_app, arrs):
    await arr_app.http.patch("/api/settings", json={**ARR_SETTINGS, "sonarr_key": "wrong-key-123"})

    r = await arr_app.http.post("/api/connect/test", json={"app": "sonarr"})

    body = r.json()
    assert body["ok"] is False
    assert "API key" in body["error"]
    assert "wrong-key-123" not in r.text


@pytest.mark.asyncio
async def test_connection_test_reports_unreachable_host(arr_app, arrs):
    await arr_app.http.patch("/api/settings", json={**ARR_SETTINGS, "radarr_url": "http://nowhere.test:7878"})

    body = (await arr_app.http.post("/api/connect/test", json={"app": "radarr"})).json()

    assert body["ok"] is False
    assert "http://nowhere.test:7878" in body["error"]


@pytest.mark.asyncio
async def test_connection_test_reports_missing_settings(arr_app, arrs):
    body = (await arr_app.http.post("/api/connect/test", json={"app": "prowlarr"})).json()

    assert body == {"app": "prowlarr", "ok": False, "error": "Prowlarr URL and API key are not set"}


@pytest.mark.asyncio
async def test_connection_test_rejects_unknown_app(arr_app, arrs):
    r = await arr_app.http.post("/api/connect/test", json={"app": "lidarr"})

    assert r.status_code == 400


# ── one-click registration ────────────────────────────────────────────
def _statuses(body: dict) -> dict:
    return {res["app"]: res["status"] for res in body["results"]}


@pytest.mark.asyncio
async def test_register_creates_newznab_indexer_in_prowlarr(arr_app, arrs):
    await arr_app.http.patch("/api/settings", json=ARR_SETTINGS)

    r = await arr_app.http.post("/api/connect/register")

    assert r.status_code == 200
    assert _statuses(r.json())["prowlarr"] == "created"
    [indexer] = arrs.prowlarr.created()
    assert indexer["name"] == "Telegrarr"
    assert indexer["implementation"] == "Newznab"
    assert indexer["configContract"] == "NewznabSettings"
    assert indexer["definitionName"] == "Generic Newznab"
    assert indexer["enable"] is True
    assert indexer["appProfileId"] == 1
    assert arrs.find_field(indexer, "baseUrl") == "http://telegrarr:8790"
    assert arrs.find_field(indexer, "apiPath") == "/api/newznab"
    assert arrs.find_field(indexer, "apiKey") == arr_app.apikey


@pytest.mark.asyncio
@pytest.mark.parametrize("app, category_field, category", [("sonarr", "tvCategory", "tv"),
                                                           ("radarr", "movieCategory", "movies")])
async def test_register_creates_sabnzbd_client(arr_app, arrs, app, category_field, category):
    await arr_app.http.patch("/api/settings", json=ARR_SETTINGS)

    r = await arr_app.http.post("/api/connect/register")

    assert _statuses(r.json())[app] == "created"
    [client] = getattr(arrs, app).created()
    assert client["name"] == "Telegrarr"
    assert client["implementation"] == "Sabnzbd"
    assert client["configContract"] == "SabnzbdSettings"
    assert client["enable"] is True
    assert arrs.find_field(client, "host") == "telegrarr"
    assert arrs.find_field(client, "port") == 8790
    assert arrs.find_field(client, "useSsl") is False
    assert arrs.find_field(client, "urlBase") == ""
    assert arrs.find_field(client, "apiKey") == arr_app.apikey
    assert arrs.find_field(client, category_field) == category


@pytest.mark.asyncio
async def test_register_https_telegrarr_url_behind_a_subpath(arr_app, arrs):
    await arr_app.http.patch("/api/settings", json={
        **ARR_SETTINGS, "telegrarr_url": "https://tg.example.com/telegrarr"})

    await arr_app.http.post("/api/connect/register")

    [client] = arrs.sonarr.created()
    assert arrs.find_field(client, "host") == "tg.example.com"
    assert arrs.find_field(client, "port") == 443
    assert arrs.find_field(client, "useSsl") is True
    assert arrs.find_field(client, "urlBase") == "/telegrarr"
    [indexer] = arrs.prowlarr.created()
    assert arrs.find_field(indexer, "baseUrl") == "https://tg.example.com/telegrarr"


@pytest.mark.asyncio
async def test_second_register_creates_nothing_new(arr_app, arrs):
    await arr_app.http.patch("/api/settings", json=ARR_SETTINGS)
    await arr_app.http.post("/api/connect/register")

    r = await arr_app.http.post("/api/connect/register")

    assert _statuses(r.json()) == {"prowlarr": "exists", "sonarr": "exists", "radarr": "exists"}
    assert len(arrs.prowlarr.created()) == 1
    assert len(arrs.sonarr.created()) == 1
    assert len(arrs.radarr.created()) == 1


@pytest.mark.asyncio
async def test_register_keeps_existing_client_with_same_name(arr_app, arrs):
    arrs.sonarr.providers.append({"id": 7, "name": "telegrarr", "implementation": "Sabnzbd", "fields": []})
    await arr_app.http.patch("/api/settings", json=ARR_SETTINGS)

    r = await arr_app.http.post("/api/connect/register")

    assert _statuses(r.json())["sonarr"] == "exists"
    assert arrs.sonarr.created() == []


@pytest.mark.asyncio
async def test_register_skips_unconfigured_apps_and_reports_failures(arr_app, arrs):
    arrs.sonarr.reject_create = "Unable to connect to SABnzbd"
    await arr_app.http.patch("/api/settings", json={**ARR_SETTINGS, "radarr_url": ""})

    body = (await arr_app.http.post("/api/connect/register")).json()

    assert _statuses(body) == {"prowlarr": "created", "sonarr": "error", "radarr": "skipped"}
    sonarr = next(res for res in body["results"] if res["app"] == "sonarr")
    assert "Unable to connect to SABnzbd" in sonarr["error"]


@pytest.mark.asyncio
async def test_register_never_echoes_api_keys(arr_app, arrs):
    await arr_app.http.patch("/api/settings", json=ARR_SETTINGS)

    r = await arr_app.http.post("/api/connect/register")

    for key in (PROWLARR_KEY, SONARR_KEY, RADARR_KEY, arr_app.apikey):
        assert key not in r.text


@pytest.mark.asyncio
async def test_register_requires_telegrarr_url(arr_app, arrs):
    await arr_app.http.patch("/api/settings", json={**ARR_SETTINGS, "telegrarr_url": ""})

    r = await arr_app.http.post("/api/connect/register")

    assert r.status_code == 400
    assert arrs.prowlarr.requests == []


# ── Sonarr episode list (reused by part resolution) ───────────────────
TVDB_ID = 81189


def _seed_sonarr_series(sonarr):
    sonarr.series.append({"id": 12, "tvdbId": TVDB_ID, "title": "Merlí"})
    sonarr.episodes.extend([
        {"seriesId": 12, "seasonNumber": 2, "episodeNumber": 2, "title": "Els sofistes"},
        {"seriesId": 12, "seasonNumber": 2, "episodeNumber": 1, "title": "Plató"},
        {"seriesId": 12, "seasonNumber": 1, "episodeNumber": 1, "title": "Els peripatètics"},
        {"seriesId": 99, "seasonNumber": 2, "episodeNumber": 1, "title": "Another show"},
    ])


@pytest.mark.asyncio
async def test_sonarr_episodes_lists_a_season_by_tvdb_id(arr_app, arrs):
    from app import connect

    _seed_sonarr_series(arrs.sonarr)
    await arr_app.http.patch("/api/settings", json=ARR_SETTINGS)

    episodes = await connect.sonarr_episodes(TVDB_ID, 2)

    assert episodes == [connect.Episode(season=2, episode=1, title="Plató"),
                        connect.Episode(season=2, episode=2, title="Els sofistes")]


@pytest.mark.asyncio
async def test_sonarr_episodes_is_empty_when_series_not_in_sonarr(arr_app, arrs):
    from app import connect

    await arr_app.http.patch("/api/settings", json=ARR_SETTINGS)

    assert await connect.sonarr_episodes(TVDB_ID, 1) == []


@pytest.mark.asyncio
async def test_sonarr_episodes_raises_when_sonarr_not_configured(arr_app, arrs):
    from app import connect

    with pytest.raises(connect.ArrError, match="Sonarr URL and API key are not set"):
        await connect.sonarr_episodes(TVDB_ID, 1)
