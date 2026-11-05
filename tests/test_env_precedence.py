"""Telegram, Plex and proxy env vars win over the database, driven over HTTP.

The env var used to be a default the saved value overrode. The outside view: the
settings API, the Telegram setup and proxy endpoints, the credentials the Telegram
client is built with, and what reaches Plex on the wire."""
import pytest

from app import tg

ENV_API_ID = 7654321
ENV_API_HASH = "env-api-hash-0123456789abcdef"
SAVED_API_ID = 1234567
SAVED_API_HASH = "saved-api-hash-fedcba9876543210"


class RecordingTelegramClient:
    """Stands in for Telethon: keeps what the client was built with, never connects."""

    def __init__(self, session, api_id, api_hash, **kwargs):
        self.api_id, self.api_hash, self.kwargs = api_id, api_hash, kwargs

    def is_connected(self):
        return False

    async def connect(self):
        return None

    async def disconnect(self):
        return None

    async def is_user_authorized(self):
        return False


@pytest.fixture()
def built_clients(arr_app, monkeypatch):
    """Every Telegram client the app builds, newest last. No client exists yet."""
    built = []

    def build(*args, **kwargs):
        built.append(RecordingTelegramClient(*args, **kwargs))
        return built[-1]

    monkeypatch.setattr(tg, "TelegramClient", build)
    monkeypatch.setattr(tg, "_client", None)
    return built


async def _save_api_creds(arr_app, api_id=SAVED_API_ID, api_hash=SAVED_API_HASH):
    r = await arr_app.http.post("/api/telegram/auth/api", json={"api_id": api_id, "api_hash": api_hash})
    assert r.json() == {"ok": True}


async def _settings(arr_app) -> dict:
    return (await arr_app.http.get("/api/settings")).raise_for_status().json()["settings"]


async def _auth(arr_app) -> dict:
    return (await arr_app.http.get("/api/telegram/auth")).raise_for_status().json()


# ── Telegram API credentials ──────────────────────────────────────────
@pytest.mark.asyncio
async def test_telegram_client_uses_the_env_credentials_over_the_database(arr_app, built_clients, monkeypatch):
    await _save_api_creds(arr_app)
    monkeypatch.setenv("TG_API_ID", str(ENV_API_ID))
    monkeypatch.setenv("TG_API_HASH", ENV_API_HASH)

    await _auth(arr_app)

    assert (built_clients[-1].api_id, built_clients[-1].api_hash) == (ENV_API_ID, ENV_API_HASH)


@pytest.mark.asyncio
@pytest.mark.parametrize("shipped", ["0", " 0 "])
async def test_the_shipped_zero_api_id_leaves_the_setup_wizard_working(arr_app, built_clients, monkeypatch, shipped):
    monkeypatch.setenv("TG_API_ID", shipped)     # .env.example ships TG_API_ID=0
    monkeypatch.setenv("TG_API_HASH", "")

    assert (await _settings(arr_app))["tg_api_id_env_locked"] is False
    await _save_api_creds(arr_app)
    await _auth(arr_app)

    assert (built_clients[-1].api_id, built_clients[-1].api_hash) == (SAVED_API_ID, SAVED_API_HASH)


@pytest.mark.asyncio
async def test_api_id_that_is_not_a_number_still_wins_and_shows_setup_as_not_ready(arr_app, built_clients, monkeypatch):
    await _save_api_creds(arr_app)
    monkeypatch.setenv("TG_API_ID", "not-a-number")

    assert (await _auth(arr_app))["api_ready"] is False
    assert (await _settings(arr_app))["tg_api_id_env_locked"] is True


@pytest.mark.asyncio
async def test_saved_credentials_apply_with_the_env_vars_unset(arr_app, built_clients):
    await _save_api_creds(arr_app)

    await _auth(arr_app)

    assert (built_clients[-1].api_id, built_clients[-1].api_hash) == (SAVED_API_ID, SAVED_API_HASH)


@pytest.mark.asyncio
@pytest.mark.parametrize("locked_env, setting", [("TG_API_ID", "tg_api_id"), ("TG_API_HASH", "tg_api_hash")])
async def test_telegram_setup_refuses_credentials_env_provides(arr_app, built_clients, monkeypatch, locked_env, setting):
    monkeypatch.setenv(locked_env, str(ENV_API_ID))

    r = await arr_app.http.post("/api/telegram/auth/api", json={"api_id": SAVED_API_ID, "api_hash": SAVED_API_HASH})

    assert r.json() == {"error": {"key": "err.settings.env_locked", "params": {"env": locked_env}}}
    assert (await _settings(arr_app))[f"{setting}_env_locked"] is True


@pytest.mark.asyncio
async def test_malformed_telegram_setup_reports_the_lock(arr_app, built_clients, monkeypatch):
    monkeypatch.setenv("TG_API_ID", str(ENV_API_ID))

    r = await arr_app.http.post("/api/telegram/auth/api", json={"api_id": "not-a-number", "api_hash": "x"})

    assert r.json()["error"]["key"] == "err.settings.env_locked"


@pytest.mark.asyncio
async def test_refused_telegram_setup_saves_neither_credential(arr_app, built_clients, monkeypatch):
    await _save_api_creds(arr_app)
    monkeypatch.setenv("TG_API_HASH", ENV_API_HASH)
    await arr_app.http.post("/api/telegram/auth/api", json={"api_id": 999, "api_hash": "new-hash"})

    monkeypatch.delenv("TG_API_HASH")
    await tg.reset_client()
    await _auth(arr_app)

    assert (built_clients[-1].api_id, built_clients[-1].api_hash) == (SAVED_API_ID, SAVED_API_HASH)


@pytest.mark.asyncio
async def test_api_hash_never_comes_back(arr_app, built_clients, monkeypatch):
    monkeypatch.setenv("TG_API_ID", str(ENV_API_ID))
    monkeypatch.setenv("TG_API_HASH", ENV_API_HASH)

    read = await arr_app.http.get("/api/settings")
    auth = await arr_app.http.get("/api/telegram/auth")
    status = await arr_app.http.get("/api/status")
    refused = await arr_app.http.post("/api/telegram/auth/api", json={"api_id": 1, "api_hash": "x"})

    assert ENV_API_HASH not in read.text + auth.text + status.text + refused.text
