"""TMDB failures reach the UI as keyed messages that never leak exception text.

Driven over HTTP (``arr_app``); TMDB is replaced at the httpx transport seam
(``app.tmdb.transport``) by a transport that fails the way the network does.
"""
import httpx
import pytest

from fake_tmdb import API_KEY

INTERNAL_DETAIL = "proxy 10.9.8.7:3128 refused (internal)"


def _unreachable(request: httpx.Request) -> httpx.Response:
    raise httpx.ConnectError(INTERNAL_DETAIL, request=request)


def _html_page(request: httpx.Request) -> httpx.Response:
    return httpx.Response(200, text="<html>captive portal</html>", headers={"content-type": "text/html"})


@pytest.fixture()
def tmdb_wire(monkeypatch):
    """Set how the TMDB wire behaves: ``tmdb_wire(handler)``."""
    from app import tmdb

    def install(handler):
        monkeypatch.setattr(tmdb, "transport", httpx.MockTransport(handler))
    return install


async def _save_tmdb_key(arr_app):
    (await arr_app.http.patch("/api/settings", json={"tmdb_key": API_KEY})).raise_for_status()


@pytest.mark.asyncio
async def test_tmdb_search_when_unreachable_names_the_error_type_only(arr_app, tmdb_wire):
    await _save_tmdb_key(arr_app)
    tmdb_wire(_unreachable)

    r = await arr_app.http.get("/api/tmdb/search", params={"q": "merlí"})

    assert r.status_code == 502
    assert r.json()["detail"] == {"key": "err.tmdb.unreachable", "params": {"error": "ConnectError"}}
    assert INTERNAL_DETAIL not in r.text


@pytest.mark.asyncio
async def test_tmdb_connection_test_when_unreachable_names_the_error_type_only(arr_app, tmdb_wire):
    tmdb_wire(_unreachable)

    r = await arr_app.http.post("/api/integrations/tmdb/test", json={"key": API_KEY})

    assert r.json()["ok"] is False
    assert r.json()["detail"] == {"key": "err.tmdb.unreachable", "params": {"error": "ConnectError"}}
    assert INTERNAL_DETAIL not in r.text
