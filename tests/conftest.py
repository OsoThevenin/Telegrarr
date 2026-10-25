"""Shared test setup for Telearr.

CRITICAL: ``app.config`` reads environment variables *at import time* and calls
``os.makedirs(DATA_DIR)`` where ``DATA_DIR`` defaults to ``/data`` (not writable
in dev/CI). So we MUST point the data/log dirs at a writable temp location and
set a secret key BEFORE any ``app.*`` module is imported. This runs at module
import (collection) time, which is before test modules import ``app.*``.
"""
import os
import tempfile

# A process-wide temp dir for the whole test session. Created here (not via the
# tmp_path fixture) because config is imported at collection time, earlier than
# any fixture can run.
_TEST_DATA_DIR = tempfile.mkdtemp(prefix="telearr-tests-")

os.environ.setdefault("TELEARR_DATA_DIR", _TEST_DATA_DIR)
os.environ.setdefault("TELEARR_LOG_DIR", os.path.join(_TEST_DATA_DIR, "logs"))
os.environ.setdefault("TELEARR_SECRET_KEY", "test-secret-key-not-for-production")

import pytest


@pytest.fixture()
def fresh_db(tmp_path, monkeypatch):
    """Give a test an isolated, initialised SQLite database.

    Rebinds ``DB_PATH`` in the config and db modules to a fresh file under the
    per-test ``tmp_path`` and (re)creates the schema. Keeps settings/auth tests
    from bleeding state into each other.
    """
    from app import config, db

    dbfile = str(tmp_path / "telearr.db")
    monkeypatch.setattr(config, "DB_PATH", dbfile, raising=False)
    monkeypatch.setattr(db, "DB_PATH", dbfile, raising=False)
    db.init()
    return dbfile


# ── HTTP harness (see tests/http_harness.py) ─────────────────────────
import asyncio

import httpx
import pytest_asyncio

from http_harness import BASE_URL, ArrApp, FakeTelegram, library_dirs_under

_TASK_DRAIN_TIMEOUT_S = 5.0


@pytest.fixture()
def fake_telegram(monkeypatch):
    """Install a :class:`FakeTelegram` as the app's shared Telegram client."""
    from app import tg

    fake = FakeTelegram()
    monkeypatch.setattr(tg, "_client", fake)
    return fake


@pytest.fixture()
def library_dirs(tmp_path, monkeypatch):
    """Point every library directory setting, and the *arr downloads base, at
    per-test tmp dirs.

    The dirs are read from ``app.config`` at import and re-bound by name in a few
    modules, so each binding is substituted. The downloads base is a runtime
    setting whose default comes from config, so its default is substituted too.
    Returns {setting name: path}.
    """
    from app import config, downloader, scanner, settings, system

    dirs = library_dirs_under(str(tmp_path / "media"))
    for module in (config, scanner, downloader, system):
        for name, path in dirs.items():
            if hasattr(module, name):
                monkeypatch.setattr(module, name, path)
    downloads = str(tmp_path / "downloads")
    monkeypatch.setitem(settings.DEFAULTS, "downloads_dir", downloads)
    return {**dirs, "DOWNLOADS_DIR": downloads}


async def _drain_background_tasks():
    """Let downloads etc. spawned by the test finish so they don't leak."""
    current = asyncio.current_task()
    pending = [t for t in asyncio.all_tasks() if t is not current and not t.done()]
    if not pending:
        return
    _, still_running = await asyncio.wait(pending, timeout=_TASK_DRAIN_TIMEOUT_S)
    for task in still_running:
        task.cancel()
    await asyncio.gather(*still_running, return_exceptions=True)


@pytest_asyncio.fixture()
async def arr_app(fresh_db, fake_telegram, library_dirs):
    """The app as Sonarr/Radarr see it: authenticated HTTP client, temp DB,
    fake Telegram client. Yields an :class:`ArrApp`."""
    from app import auth
    from app.main import app

    auth.ensure_default_user()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url=BASE_URL) as http:
        http.cookies.set("telearr_sess", auth.make_cookie("admin"))
        settings = (await http.get("/api/settings")).raise_for_status().json()
        yield ArrApp(http=http, telegram=fake_telegram, apikey=settings["arr"]["apikey"])
        await _drain_background_tasks()
