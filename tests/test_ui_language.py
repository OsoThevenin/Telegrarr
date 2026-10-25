"""The UI speaks Catalan by default and English on request: API errors are
message keys the SPA translates, and text the server renders itself (login
page, notifications) follows the chosen language."""
import pytest

from app.i18n import DEFAULT_LANG


async def _set_lang(arr_app, lang):
    r = await arr_app.http.patch("/api/settings", json={"ui_lang": lang})
    assert r.status_code == 200


def _detail(r):
    return r.json()["detail"]


# ── API errors carry keys ────────────────────────────────────────────
@pytest.mark.asyncio
async def test_language_is_catalan_until_switched(arr_app):
    s = (await arr_app.http.get("/api/settings")).json()["settings"]
    assert s["ui_lang"] == DEFAULT_LANG == "ca"


@pytest.mark.asyncio
async def test_unknown_language_is_a_keyed_400(arr_app):
    r = await arr_app.http.patch("/api/settings", json={"ui_lang": "fr"})
    assert r.status_code == 400
    assert _detail(r) == {"key": "err.settings.ui_lang", "params": {}}


@pytest.mark.asyncio
@pytest.mark.parametrize("payload, key", [
    ({}, "err.channel.chat_id_required"),
    ({"chat_id": "abc"}, "err.channel.chat_id_numeric"),
])
async def test_channel_validation_errors_carry_keys(arr_app, payload, key):
    r = await arr_app.http.post("/api/channels", json=payload)
    assert r.status_code == 400
    assert _detail(r)["key"] == key


@pytest.mark.asyncio
async def test_bad_release_choice_names_the_field_and_its_choices(arr_app):
    r = await arr_app.http.post("/api/channels", json={"chat_id": -1001, "fallback_quality": "4320p"})
    assert r.status_code == 400
    detail = _detail(r)
    assert detail["key"] == "err.channel.choice"
    assert detail["params"]["field"] == "fallback_quality"
    assert "1080p" in detail["params"]["choices"]


@pytest.mark.asyncio
async def test_unknown_connect_app_is_a_keyed_400(arr_app):
    r = await arr_app.http.post("/api/connect/test", json={"app": "lidarr"})
    assert r.status_code == 400
    assert _detail(r)["key"] == "err.connect.unknown_app"


@pytest.mark.asyncio
async def test_registering_without_own_url_is_a_keyed_400(arr_app):
    r = await arr_app.http.post("/api/connect/register")
    assert r.status_code == 400
    assert _detail(r)["key"] == "err.connect.own_url_missing"


@pytest.mark.asyncio
async def test_wrong_current_password_is_a_keyed_400(arr_app):
    r = await arr_app.http.post("/api/account/password", json={"current": "nope", "new": "long-enough-pw"})
    assert r.status_code == 400
    assert _detail(r)["key"] == "err.account.wrong_password"


@pytest.mark.asyncio
async def test_empty_directory_import_is_a_keyed_400(arr_app):
    r = await arr_app.http.post("/api/directory/import", json={"channels": []})
    assert r.status_code == 400
    assert _detail(r)["key"] == "err.directory.import_empty"


@pytest.mark.asyncio
@pytest.mark.parametrize("path, body, field", [
    ("/api/directory/import", {"channels": ["x"]}, "channels.0"),
    ("/api/connect/test", {"app": ["sonarr"]}, "app"),
])
async def test_a_malformed_request_body_is_a_keyed_400_naming_the_field(arr_app, path, body, field):
    r = await arr_app.http.post(path, json=body)
    assert r.status_code == 400
    assert _detail(r) == {"key": "err.request.invalid", "params": {"field": field}}


@pytest.mark.asyncio
async def test_telegram_setup_errors_carry_keys(arr_app):
    r = await arr_app.http.post("/api/telegram/auth/api", json={"api_id": "not-a-number", "api_hash": "x"})
    assert r.json()["error"] == {"key": "err.tg.api_id_number", "params": {}}


# ── server-rendered text follows the language ────────────────────────
@pytest.mark.asyncio
async def test_failed_login_redirects_with_an_error_code_not_prose(arr_app):
    r = await arr_app.http.post("/login", data={"username": "admin", "password": "wrong"})
    assert r.status_code == 303
    assert r.headers["location"] == "/login?error=invalid"


@pytest.mark.asyncio
async def test_login_page_is_catalan_by_default(arr_app):
    page = (await arr_app.http.get("/login", params={"error": "invalid"})).text
    assert '<html lang="ca"' in page
    assert "Inicia la sessió" in page
    assert "Credencials incorrectes" in page


@pytest.mark.asyncio
async def test_login_page_restores_english(arr_app):
    await _set_lang(arr_app, "en")
    page = (await arr_app.http.get("/login", params={"error": "invalid"})).text
    assert '<html lang="en"' in page
    assert "Sign in" in page
    assert "Invalid credentials" in page


@pytest.mark.asyncio
async def test_spa_shell_declares_the_language(arr_app):
    assert '<html lang="ca"' in (await arr_app.http.get("/")).text
    await _set_lang(arr_app, "en")
    assert '<html lang="en"' in (await arr_app.http.get("/")).text


@pytest.mark.asyncio
@pytest.mark.parametrize("lang, text", [("ca", "Notificació de prova"), ("en", "test notification")])
async def test_notifications_are_sent_in_the_chosen_language(arr_app, lang, text):
    await arr_app.http.patch("/api/settings", json={"notify_telegram": True, "ui_lang": lang})

    r = await arr_app.http.post("/api/integrations/notify/test")

    assert r.json()["ok"] is True
    [sent] = arr_app.telegram.saved_messages
    assert text in sent
