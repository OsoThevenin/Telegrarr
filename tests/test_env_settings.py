"""Env-backed settings: an env var wins over the database, driven over HTTP.

The outside view: the settings API, and what actually reaches TMDB and the *arr
apps on the wire (tests/fake_tmdb.py, tests/fake_arr.py)."""
import pytest

from fake_arr import PROWLARR_KEY, RADARR_KEY, SONARR_KEY
from fake_tmdb import API_KEY as TMDB_KEY

MOVIE_CHAT = -1003333333333
THEORY_TMDB = 266856
ENV_FOR_APP = {
    "prowlarr": ("TELEARR_PROWLARR_URL", "http://prowlarr.test:9696", "TELEARR_PROWLARR_KEY", PROWLARR_KEY),
    "sonarr": ("TELEARR_SONARR_URL", "http://sonarr.test:8989", "TELEARR_SONARR_KEY", SONARR_KEY),
    "radarr": ("TELEARR_RADARR_URL", "http://radarr.test:7878", "TELEARR_RADARR_KEY", RADARR_KEY),
}


def _set_arr_env(monkeypatch, app: str) -> None:
    url_var, url, key_var, key = ENV_FOR_APP[app]
    monkeypatch.setenv(url_var, url)
    monkeypatch.setenv(key_var, key)


async def _settings(arr_app) -> dict:
    return (await arr_app.http.get("/api/settings")).raise_for_status().json()["settings"]


# ── the env value is the effective value ──────────────────────────────
@pytest.mark.asyncio
async def test_tmdb_lookup_uses_the_env_key_over_the_database(arr_app, fake_tmdb, monkeypatch):
    await arr_app.http.patch("/api/settings", json={"tmdb_key": "stale-database-key"})
    monkeypatch.setenv("TELEARR_TMDB_KEY", TMDB_KEY)

    r = await arr_app.http.get("/api/tmdb/search", params={"q": "Plats Bruts"})

    assert r.status_code == 200


@pytest.mark.asyncio
async def test_tmdb_key_test_checks_the_env_key(arr_app, fake_tmdb, monkeypatch):
    await arr_app.http.patch("/api/settings", json={"tmdb_key": "stale-database-key"})
    monkeypatch.setenv("TELEARR_TMDB_KEY", TMDB_KEY)

    r = await arr_app.http.post("/api/integrations/tmdb/test", json={})

    assert r.json()["ok"] is True


@pytest.mark.asyncio
@pytest.mark.parametrize("app", ENV_FOR_APP)
async def test_connection_uses_the_env_url_and_key_on_a_fresh_database(arr_app, arrs, monkeypatch, app):
    _set_arr_env(monkeypatch, app)

    r = await arr_app.http.post("/api/connect/test", json={"app": app})

    assert r.json()["ok"] is True


@pytest.mark.asyncio
@pytest.mark.parametrize("app", ENV_FOR_APP)
async def test_connection_uses_the_env_values_over_the_database(arr_app, arrs, monkeypatch, app):
    await arr_app.http.patch("/api/settings", json={f"{app}_url": "http://stale.test:1", f"{app}_key": "stale-key"})
    _set_arr_env(monkeypatch, app)

    r = await arr_app.http.post("/api/connect/test", json={"app": app})

    assert r.json()["ok"] is True


@pytest.mark.asyncio
async def test_settings_api_reports_the_env_url_over_the_database(arr_app, monkeypatch):
    await arr_app.http.patch("/api/settings", json={"sonarr_url": "http://stale.test:1"})
    monkeypatch.setenv("TELEARR_SONARR_URL", "http://sonarr.test:8989")

    assert (await _settings(arr_app))["sonarr_url"] == "http://sonarr.test:8989"


@pytest.mark.asyncio
async def test_key_set_flags_follow_the_env_on_a_fresh_database(arr_app, monkeypatch):
    monkeypatch.setenv("TELEARR_TMDB_KEY", "env-tmdb-key")
    monkeypatch.setenv("TELEARR_RADARR_KEY", "env-radarr-key")

    view = await _settings(arr_app)

    assert view["tmdb_key_set"] is True
    assert view["radarr_key_set"] is True
    assert view["sonarr_key_set"] is False


@pytest.mark.asyncio
async def test_env_url_is_normalised_like_a_saved_one(arr_app, arrs, monkeypatch):
    _set_arr_env(monkeypatch, "sonarr")
    monkeypatch.setenv("TELEARR_SONARR_URL", " http://sonarr.test:8989/ ")

    r = await arr_app.http.post("/api/connect/test", json={"app": "sonarr"})

    assert r.json()["ok"] is True
    assert (await _settings(arr_app))["sonarr_url"] == "http://sonarr.test:8989"


@pytest.mark.asyncio
async def test_catalog_film_links_to_the_env_radarr_url(arr_app, arrs, fake_tmdb, monkeypatch):
    fake_tmdb.add_movie(THEORY_TMDB, titles={"ca-ES": "La teoria del tot", "en-US": "The Theory of Everything"},
                        release_date="2014-11-07", imdb_id="tt2980516")
    monkeypatch.setenv("TELEARR_TMDB_KEY", TMDB_KEY)
    _set_arr_env(monkeypatch, "radarr")
    arr_app.telegram.add_channel(MOVIE_CHAT, "Pel·lícules en català")
    channel = await arr_app.add_channel(MOVIE_CHAT, kind="movie")
    arr_app.telegram.post(MOVIE_CHAT, text="La teoria del tot (2014)", file_name="La.teoria.del.tot.2014.1080p.mkv")
    await arr_app.scan(channel["id"])

    rows = (await arr_app.http.get(f"/api/channels/{channel['id']}/catalog")).json()["rows"]

    assert [row["radarr_link"] for row in rows] == [f"http://radarr.test:7878/movie/{THEORY_TMDB}"]


@pytest.mark.asyncio
async def test_env_url_of_another_scheme_still_wins_and_fails_as_a_connection(arr_app, arrs, monkeypatch):
    await arr_app.http.patch("/api/settings", json={"sonarr_url": "http://saved.test:8989"})
    _set_arr_env(monkeypatch, "sonarr")
    monkeypatch.setenv("TELEARR_SONARR_URL", "sonarr.test:8989")

    r = await arr_app.http.post("/api/connect/test", json={"app": "sonarr"})

    assert r.json()["ok"] is False
    assert r.json()["error"]["key"] == "err.arr.unreachable"
    assert (await _settings(arr_app))["sonarr_url"] == "sonarr.test:8989"


# ── without an env value the database decides, as before ──────────────
@pytest.mark.asyncio
@pytest.mark.parametrize("blank", ["", "   "])
async def test_blank_env_var_falls_back_to_the_database(arr_app, monkeypatch, blank):
    await arr_app.http.patch("/api/settings", json={"sonarr_url": "http://saved.test:8989"})
    monkeypatch.setenv("TELEARR_SONARR_URL", blank)

    assert (await _settings(arr_app))["sonarr_url"] == "http://saved.test:8989"


@pytest.mark.asyncio
async def test_unset_env_var_falls_back_to_the_database_then_the_default(arr_app):
    assert (await _settings(arr_app))["radarr_url"] == ""

    await arr_app.http.patch("/api/settings", json={"radarr_url": "http://saved.test:7878"})

    assert (await _settings(arr_app))["radarr_url"] == "http://saved.test:7878"


@pytest.mark.asyncio
async def test_database_value_returns_when_the_env_var_is_removed(arr_app, monkeypatch):
    await arr_app.http.patch("/api/settings", json={"radarr_url": "http://saved.test:7878"})
    monkeypatch.setenv("TELEARR_RADARR_URL", "http://radarr.env:7878")
    assert (await _settings(arr_app))["radarr_url"] == "http://radarr.env:7878"

    monkeypatch.delenv("TELEARR_RADARR_URL")

    assert (await _settings(arr_app))["radarr_url"] == "http://saved.test:7878"
