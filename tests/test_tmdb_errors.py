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


@pytest.mark.asyncio
async def test_tmdb_search_answered_with_a_non_json_page_is_a_keyed_502(arr_app, tmdb_wire):
    await _save_tmdb_key(arr_app)
    tmdb_wire(_html_page)

    r = await arr_app.http.get("/api/tmdb/search", params={"q": "merlí"})

    assert r.status_code == 502
    assert r.json()["detail"] == {"key": "err.tmdb.not_json", "params": {}}


@pytest.mark.asyncio
@pytest.mark.parametrize("path, params", [("/api/tmdb/search", {"q": "merlí"}),
                                          ("/api/tmdb/movies", {"q": "pa negre"})])
async def test_tmdb_searches_without_key_are_400(arr_app, tmdb_wire, path, params):
    tmdb_wire(_unreachable)

    r = await arr_app.http.get(path, params=params)

    assert (r.status_code, r.json()["detail"]["key"]) == (400, "err.tmdb.key_missing")


@pytest.mark.asyncio
async def test_movie_search_when_tmdb_is_unreachable_is_502(arr_app, tmdb_wire):
    await _save_tmdb_key(arr_app)
    tmdb_wire(_unreachable)

    r = await arr_app.http.get("/api/tmdb/movies", params={"q": "pa negre"})

    assert (r.status_code, r.json()["detail"]["key"]) == (502, "err.tmdb.unreachable")


@pytest.mark.asyncio
async def test_mapping_a_series_when_tmdb_is_unreachable_is_502(arr_app, tmdb_wire):
    await _save_tmdb_key(arr_app)
    arr_app.telegram.add_channel(-1003000000001, "Merlí CAT")
    channel = await arr_app.add_channel(-1003000000001)
    tmdb_wire(_unreachable)

    r = await arr_app.http.put(f"/api/channels/{channel['id']}/series", json={"tmdb_id": 61662})

    assert (r.status_code, r.json()["detail"]["key"]) == (502, "err.tmdb.unreachable")
