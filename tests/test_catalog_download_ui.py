"""The Catalog's Download (Baixar) controls: which button a film row offers, what the
row shows once Radarr accepted, and what the error toast says when it didn't.

The decisions live in the pure UI module ``catalog-download.js``, run in node on
the shapes the status and download endpoints answer with; catalog.js wires them
to the DOM and owns the toast with its retry and close buttons.
"""
import json

import pytest

from js_module import needs_node, run_module

LANGS = ("en", "ca")
TITLE = "Wonka"


async def _call(arr_app, expr: str):
    module = (await arr_app.http.get("/static/js/catalog-download.js")).raise_for_status().text
    return run_module(module, f"m.{expr}")


def _button(status: dict, available: bool = True) -> str:
    return f"downloadButton({json.dumps(status)}, {json.dumps(available)}, {json.dumps(TITLE)})"


@pytest.mark.asyncio
@needs_node
async def test_a_film_radarr_lacks_offers_a_filled_baixar(arr_app):
    assert await _call(arr_app, _button({"status": "missing"})) == {
        "kind": "get", "disabled": False,
        "label": {"key": "cat.download"}, "aria": {"key": "cat.download_aria", "params": {"title": TITLE}}}


@pytest.mark.asyncio
@needs_node
async def test_an_upgradeable_film_offers_baixar_at_the_channels_best_resolution(arr_app):
    upgrade = {"status": "upgrade", "radarr_quality": "720p", "best_quality": "1080p"}

    assert await _call(arr_app, _button(upgrade)) == {
        "kind": "upgrade", "disabled": False,
        "label": {"key": "cat.download_quality", "params": {"quality": "1080p"}},
        "aria": {"key": "cat.upgrade_aria", "params": {"from": "720p", "to": "1080p"}}}


@pytest.mark.asyncio
@needs_node
async def test_while_radarr_is_unavailable_baixar_stays_disabled(arr_app):
    button = await _call(arr_app, _button({}, available=False))

    assert (button["kind"], button["disabled"]) == ("get", True)


@pytest.mark.asyncio
@needs_node
@pytest.mark.parametrize("status", [{"status": "downloaded", "radarr_quality": "1080p"}, {"status": "requested"}],
                         ids=["downloaded", "requested"])
async def test_a_downloaded_or_requested_film_offers_no_baixar(arr_app, status):
    assert await _call(arr_app, _button(status)) is None


@pytest.mark.asyncio
@needs_node
@pytest.mark.parametrize("before, after", [
    ({"status": "missing"}, {"status": "requested"}),
    ({"status": "upgrade", "radarr_quality": "720p", "best_quality": "1080p"},
     {"status": "requested", "radarr_quality": "720p", "best_quality": "1080p"}),   # as /status reads it
], ids=["missing", "upgrade-keeps-baixada"])
async def test_an_accepted_request_turns_the_row_requested(arr_app, before, after):
    assert await _call(arr_app, f"requestedStatus({json.dumps(before)})") == after


@pytest.mark.asyncio
@needs_node
@pytest.mark.parametrize("answer, reason", [
    ({"ok": False, "status": 502, "body": {"detail": {"key": "err.arr.http",
                                                      "params": {"app": "Radarr", "status": 503, "detail": ""}}}},
     {"key": "err.arr.http", "params": {"app": "Radarr", "status": 503, "detail": ""}}),
    ({"ok": False, "status": 500, "body": None}, {"key": "common.http_error", "params": {"status": 500}}),
    ({"ok": False, "status": 0, "body": None}, {"key": "common.network_error"}),
], ids=["radarr-reason", "no-detail", "network"])
async def test_a_failed_request_names_the_film_and_radarrs_reason(arr_app, answer, reason):
    toast = await _call(arr_app, f"failureToast({json.dumps(TITLE)}, {json.dumps(answer)})")

    assert toast == {"title": {"key": "cat.download_failed", "params": {"title": TITLE}}, "reason": reason}


@pytest.mark.asyncio
@pytest.mark.parametrize("lang", LANGS)
async def test_every_download_string_is_translated(arr_app, lang):
    strings = (await arr_app.http.get(f"/static/i18n/{lang}.json")).raise_for_status().json()
    keys = ("cat.download", "cat.download_aria", "cat.download_quality", "cat.upgrade_aria", "cat.download_failed",
            "cat.nothing_added", "cat.retry", "cat.dismiss", "err.catalog.not_in_catalog")

    assert [k for k in keys if not strings.get(k)] == []
    assert "{reason}" in strings["cat.nothing_added"]


def test_the_catalan_strings_match_the_design():
    from pathlib import Path
    ca = json.loads((Path(__file__).resolve().parent.parent / "app/static/i18n/ca.json").read_text(encoding="utf-8"))

    assert ca["cat.download"] == "Baixar"
    assert ca["cat.upgrade_aria"] == "Baixar millora de {from} a {to}"
    assert ca["cat.download_failed"] == "No s’ha pogut demanar «{title}»"
    assert ca["cat.retry"] == "Torna-ho a provar"


@pytest.mark.asyncio
async def test_the_catalog_posts_downloads_and_uses_the_decisions(arr_app):
    module = (await arr_app.http.get("/static/js/catalog.js")).raise_for_status().text
    sw = (await arr_app.http.get("/sw.js")).raise_for_status().text

    assert 'from "./catalog-download.js"' in module
    assert "/download`" in module
    for call in ("downloadButton(", "requestedStatus(", "failureToast("):
        assert call in module
    assert "/static/js/catalog-download.js" in sw
