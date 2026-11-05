"""Env-backed settings: an env var wins over the database, driven over HTTP.

The outside view: the settings API, and what actually reaches TMDB and the *arr
apps on the wire (tests/fake_tmdb.py, tests/fake_arr.py)."""
import pytest

from app import i18n
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

    assert (await arr_app.settings())["sonarr_url"] == "http://sonarr.test:8989"


@pytest.mark.asyncio
async def test_key_set_flags_follow_the_env_on_a_fresh_database(arr_app, monkeypatch):
    monkeypatch.setenv("TELEARR_TMDB_KEY", "env-tmdb-key")
    monkeypatch.setenv("TELEARR_RADARR_KEY", "env-radarr-key")

    view = await arr_app.settings()

    assert view["tmdb_key_set"] is True
    assert view["radarr_key_set"] is True
    assert view["sonarr_key_set"] is False


@pytest.mark.asyncio
async def test_env_url_is_normalised_like_a_saved_one(arr_app, arrs, monkeypatch):
    _set_arr_env(monkeypatch, "sonarr")
    monkeypatch.setenv("TELEARR_SONARR_URL", " http://sonarr.test:8989/ ")

    r = await arr_app.http.post("/api/connect/test", json={"app": "sonarr"})

    assert r.json()["ok"] is True
    assert (await arr_app.settings())["sonarr_url"] == "http://sonarr.test:8989"


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
    assert (await arr_app.settings())["sonarr_url"] == "sonarr.test:8989"


# ── without an env value the database decides, as before ──────────────
@pytest.mark.asyncio
@pytest.mark.parametrize("blank", ["", "   "])
async def test_blank_env_var_falls_back_to_the_database(arr_app, monkeypatch, blank):
    await arr_app.http.patch("/api/settings", json={"sonarr_url": "http://saved.test:8989"})
    monkeypatch.setenv("TELEARR_SONARR_URL", blank)

    assert (await arr_app.settings())["sonarr_url"] == "http://saved.test:8989"


@pytest.mark.asyncio
async def test_unset_env_var_falls_back_to_the_database_then_the_default(arr_app):
    assert (await arr_app.settings())["radarr_url"] == ""

    await arr_app.http.patch("/api/settings", json={"radarr_url": "http://saved.test:7878"})

    assert (await arr_app.settings())["radarr_url"] == "http://saved.test:7878"


@pytest.mark.asyncio
async def test_database_value_returns_when_the_env_var_is_removed(arr_app, monkeypatch):
    await arr_app.http.patch("/api/settings", json={"radarr_url": "http://saved.test:7878"})
    monkeypatch.setenv("TELEARR_RADARR_URL", "http://radarr.env:7878")
    assert (await arr_app.settings())["radarr_url"] == "http://radarr.env:7878"

    monkeypatch.delenv("TELEARR_RADARR_URL")

    assert (await arr_app.settings())["radarr_url"] == "http://saved.test:7878"


# ── the settings payload reports what env locks ───────────────────────
ENV_LOCK_FLAGS = {"tmdb_key_env_locked", "prowlarr_url_env_locked", "prowlarr_key_env_locked",
                  "sonarr_url_env_locked", "sonarr_key_env_locked", "radarr_url_env_locked",
                  "radarr_key_env_locked"}


@pytest.mark.asyncio
async def test_nothing_is_env_locked_with_the_env_vars_unset(arr_app):
    view = await arr_app.settings()

    assert {flag: view[flag] for flag in ENV_LOCK_FLAGS} == dict.fromkeys(ENV_LOCK_FLAGS, False)


@pytest.mark.asyncio
async def test_payload_marks_exactly_the_settings_env_provides(arr_app, monkeypatch):
    monkeypatch.setenv("TELEARR_TMDB_KEY", "env-tmdb-key")
    monkeypatch.setenv("TELEARR_SONARR_URL", "http://sonarr.test:8989")

    view = await arr_app.settings()

    assert {flag for flag in ENV_LOCK_FLAGS if view[flag]} == {"tmdb_key_env_locked", "sonarr_url_env_locked"}


@pytest.mark.asyncio
async def test_a_blank_env_var_does_not_lock(arr_app, monkeypatch):
    monkeypatch.setenv("TELEARR_TMDB_KEY", "  ")

    assert (await arr_app.settings())["tmdb_key_env_locked"] is False


# ── writes to a locked setting are refused ────────────────────────────
LOCKED_WRITES = [
    ("tmdb_key", "TELEARR_TMDB_KEY", "new-key"),
    ("prowlarr_url", "TELEARR_PROWLARR_URL", "http://new.test:1"),
    ("prowlarr_key", "TELEARR_PROWLARR_KEY", "new-key"),
    ("sonarr_url", "TELEARR_SONARR_URL", "http://new.test:1"),
    ("sonarr_key", "TELEARR_SONARR_KEY", "new-key"),
    ("radarr_url", "TELEARR_RADARR_URL", "http://new.test:1"),
    ("radarr_key", "TELEARR_RADARR_KEY", "new-key"),
]


@pytest.mark.asyncio
@pytest.mark.parametrize("setting, env_var, value", LOCKED_WRITES)
async def test_write_to_a_locked_setting_is_refused_with_a_keyed_error(arr_app, monkeypatch, setting, env_var, value):
    monkeypatch.setenv(env_var, "http://env.test:1")

    r = await arr_app.http.patch("/api/settings", json={setting: value})

    assert r.status_code == 400
    assert r.json()["detail"] == {"key": "err.settings.env_locked", "params": {"env": env_var}}


@pytest.mark.parametrize("lang, expected", [
    ("en", "Set by the environment variable TELEARR_TMDB_KEY. Change it there."),
    ("ca", "Definit per la variable d’entorn TELEARR_TMDB_KEY. Canvia-la allà."),
])
def test_refusal_reads_in_both_languages(lang, expected):
    assert i18n.translate("err.settings.env_locked", lang, env="TELEARR_TMDB_KEY") == expected


@pytest.mark.asyncio
async def test_clearing_a_locked_setting_is_refused(arr_app, monkeypatch):
    monkeypatch.setenv("TELEARR_TMDB_KEY", "env-tmdb-key")

    r = await arr_app.http.patch("/api/settings", json={"tmdb_key": ""})

    assert r.status_code == 400


@pytest.mark.asyncio
async def test_malformed_write_to_a_locked_setting_reports_the_lock(arr_app, monkeypatch):
    monkeypatch.setenv("TELEARR_SONARR_URL", "http://sonarr.test:8989")

    r = await arr_app.http.patch("/api/settings", json={"sonarr_url": "ftp://new.test"})

    assert r.json()["detail"]["key"] == "err.settings.env_locked"


@pytest.mark.asyncio
async def test_refused_write_leaves_the_saved_value_for_when_the_env_var_goes(arr_app, monkeypatch):
    await arr_app.http.patch("/api/settings", json={"sonarr_url": "http://saved.test:8989"})
    monkeypatch.setenv("TELEARR_SONARR_URL", "http://sonarr.test:8989")
    await arr_app.http.patch("/api/settings", json={"sonarr_url": "http://new.test:1"})

    monkeypatch.delenv("TELEARR_SONARR_URL")

    assert (await arr_app.settings())["sonarr_url"] == "http://saved.test:8989"


@pytest.mark.asyncio
async def test_patch_touching_a_locked_setting_persists_nothing(arr_app, monkeypatch):
    monkeypatch.setenv("TELEARR_SONARR_KEY", "env-sonarr-key")

    r = await arr_app.http.patch("/api/settings", json={"daily_budget_gb": 5, "sonarr_key": "new-key"})

    assert r.status_code == 400
    assert (await arr_app.settings())["daily_budget_gb"] == 0


@pytest.mark.asyncio
async def test_other_settings_stay_writable_next_to_a_locked_one(arr_app, monkeypatch):
    monkeypatch.setenv("TELEARR_SONARR_URL", "http://sonarr.test:8989")

    r = await arr_app.http.patch("/api/settings", json={"sonarr_external_url": "https://sonarr.example.com",
                                                        "sonarr_key": "saved-key"})

    assert r.status_code == 200
    assert r.json()["settings"]["sonarr_external_url"] == "https://sonarr.example.com"
    assert r.json()["settings"]["sonarr_key_set"] is True


@pytest.mark.asyncio
async def test_null_for_a_locked_setting_is_no_write(arr_app, monkeypatch):
    monkeypatch.setenv("TELEARR_TMDB_KEY", "env-tmdb-key")

    r = await arr_app.http.patch("/api/settings", json={"tmdb_key": None})

    assert r.status_code == 200


# ── env-provided keys never come back ─────────────────────────────────
@pytest.mark.asyncio
async def test_settings_responses_never_echo_env_keys(arr_app, monkeypatch):
    secrets = {"TELEARR_TMDB_KEY": "env-secret-tmdb", "TELEARR_PROWLARR_KEY": "env-secret-prowlarr",
               "TELEARR_SONARR_KEY": "env-secret-sonarr", "TELEARR_RADARR_KEY": "env-secret-radarr"}
    for name, value in secrets.items():
        monkeypatch.setenv(name, value)

    read = await arr_app.http.get("/api/settings")
    saved = await arr_app.http.patch("/api/settings", json={"daily_budget_gb": 5})
    refused = await arr_app.http.patch("/api/settings", json={"tmdb_key": "new-key"})

    for value in secrets.values():
        assert value not in read.text + saved.text + refused.text


@pytest.mark.asyncio
async def test_failed_connection_test_does_not_echo_the_env_key(arr_app, arrs, monkeypatch):
    _set_arr_env(monkeypatch, "sonarr")
    monkeypatch.setenv("TELEARR_SONARR_KEY", "env-secret-sonarr")

    r = await arr_app.http.post("/api/connect/test", json={"app": "sonarr"})

    assert r.json()["ok"] is False
    assert "env-secret-sonarr" not in r.text


@pytest.mark.asyncio
async def test_rejected_tmdb_key_test_does_not_echo_the_env_key(arr_app, fake_tmdb, monkeypatch):
    monkeypatch.setenv("TELEARR_TMDB_KEY", "env-secret-tmdb")

    r = await arr_app.http.post("/api/integrations/tmdb/test", json={})

    assert r.json()["ok"] is False
    assert "env-secret-tmdb" not in r.text
