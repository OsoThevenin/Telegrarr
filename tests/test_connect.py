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
