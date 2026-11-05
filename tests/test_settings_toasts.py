"""The toasts of the Settings saves: a write env refuses never reads as saved.

The decisions live in the pure UI module ``settings-toasts.js``, run in node on what
the endpoints really answer; views.js wires them to the buttons.
"""
import json

import pytest

from js_module import needs_node, run_module

SAVED_KEY = "set.plex_saved"


async def _toast(arr_app, call: str, response) -> dict | None:
    module = (await arr_app.http.get("/static/js/settings-toasts.js")).raise_for_status().text
    return run_module(module, f"m.{call.format(json.dumps(response))}")


@pytest.mark.asyncio
@needs_node
async def test_a_save_the_server_accepted_says_saved(arr_app):
    r = await arr_app.http.patch("/api/settings", json={"plex_url": "http://plex.test:32400"})

    toast = await _toast(arr_app, f"savedToast({{}}, {json.dumps(SAVED_KEY)})", r.json())

    assert toast == {"key": SAVED_KEY, "kind": "ok"}


@pytest.mark.asyncio
@needs_node
async def test_a_save_the_server_refused_says_nothing_more(arr_app, monkeypatch):
    """api() answers null for an HTTP error, once it has shown the server's reason."""
    monkeypatch.setenv("PLEX_URL", "http://plex.env:32400")
    r = await arr_app.http.patch("/api/settings", json={"plex_url": "http://plex.test:32400"})
    assert r.status_code == 400

    assert await _toast(arr_app, f"savedToast({{}}, {json.dumps(SAVED_KEY)})", None) is None


@pytest.mark.asyncio
@needs_node
async def test_clearing_the_proxy_says_cleared(arr_app):
    r = await arr_app.http.post("/api/telegram/proxy", json={"proxy": ""})

    assert await _toast(arr_app, "proxyClearToast({})", r.json()) == {"key": "set.proxy_cleared", "kind": "ok"}


@pytest.mark.asyncio
@needs_node
async def test_clearing_a_proxy_env_provides_shows_why_it_was_refused(arr_app, monkeypatch):
    monkeypatch.setenv("TELEARR_PROXY", "socks5://127.0.0.1:9")
    r = await arr_app.http.post("/api/telegram/proxy", json={"proxy": ""})

    assert await _toast(arr_app, "proxyClearToast({})", r.json()) == {
        "key": "err.settings.env_locked", "params": {"env": "TELEARR_PROXY"}, "kind": "err"}


@pytest.mark.asyncio
@needs_node
async def test_a_proxy_clear_that_failed_outright_says_nothing_more(arr_app):
    assert await _toast(arr_app, "proxyClearToast({})", None) is None


@pytest.mark.asyncio
async def test_the_settings_view_uses_the_toast_decisions(arr_app):
    views = (await arr_app.http.get("/static/js/views.js")).raise_for_status().text

    assert 'from "./settings-toasts.js"' in views
    for call in ('"set.plex_saved")', '"set.tmdb_saved")', "proxyClearToast("):
        assert call in views
    for unconditional in ('toast(t("set.plex_saved")', 'toast(t("set.tmdb_saved")', 'toast(t("set.proxy_cleared")'):
        assert unconditional not in views
