"""The Catalog toolbar's decisions: which filter chips are pressed or disabled, what
counts they show, what the footer says and which page the list asks for next.

They live in the pure UI module ``catalog-filters.js``, run in node on the shapes
``GET /api/channels/{cid}/catalog`` and ``…/catalog/status`` answer with.
"""
import json

import pytest

from js_module import needs_node, run_module

COUNTS = {"all": 5, "missing": 1, "downloaded": 2, "upgrade": 1}
OFFLINE_COUNTS = {"all": 5, "missing": None, "downloaded": None, "upgrade": None}


async def _call(arr_app, call: str):
    module = (await arr_app.http.get("/static/js/catalog-filters.js")).raise_for_status().text
    return run_module(module, f"m.{call}")


@pytest.mark.asyncio
@needs_node
async def test_chips_show_whole_channel_counts_and_press_the_chosen_filter(arr_app):
    chips = await _call(arr_app, f"chipStates({json.dumps(COUNTS)}, true, 'downloaded')")

    assert chips == [
        {"id": "all", "label": "cat.filter_all", "count": "5", "pressed": False, "disabled": False},
        {"id": "missing", "label": "cat.filter_missing", "count": "1", "pressed": False, "disabled": False},
        {"id": "downloaded", "label": "cat.filter_downloaded", "count": "2", "pressed": True, "disabled": False},
        {"id": "upgrade", "label": "cat.filter_upgrade", "count": "1", "pressed": False, "disabled": False},
    ]


@pytest.mark.asyncio
@needs_node
async def test_while_radarr_is_unavailable_only_all_is_enabled_and_the_rest_show_a_dash(arr_app):
    chips = await _call(arr_app, f"chipStates({json.dumps(OFFLINE_COUNTS)}, false, 'all')")

    assert [(c["count"], c["disabled"]) for c in chips] == [("5", False), ("–", True), ("–", True), ("–", True)]


@pytest.mark.asyncio
@needs_node
async def test_while_radarr_is_being_checked_status_counts_wait_but_all_is_shown(arr_app):
    chips = await _call(arr_app, f"chipStates({json.dumps(OFFLINE_COUNTS)}, null, 'all')")

    assert [(c["count"], c["disabled"]) for c in chips] == [("5", False), ("…", True), ("…", True), ("…", True)]


@pytest.mark.asyncio
@needs_node
@pytest.mark.parametrize("page, expected", [
    ({"loaded": 50, "count": 312, "searching": False, "next_offset": 50},
     {"key": "cat.showing", "params": {"shown": 50, "total": 312}, "more": True}),
    ({"loaded": 12, "count": 12, "searching": True, "next_offset": None},
     {"key": "cat.results", "n": 12, "more": False}),         # a plural message: tn(key, n)
], ids=["browsing", "searching"])
async def test_the_footer_says_how_much_is_shown_and_offers_more_while_pages_remain(arr_app, page, expected):
    assert await _call(arr_app, f"footerState({json.dumps(page)})") == expected


@pytest.mark.asyncio
@needs_node
async def test_the_page_url_carries_only_the_parameters_in_use(arr_app):
    plain = await _call(arr_app, "pageUrl(7, {q: '', filter: 'all', offset: 0})")
    filtered = await _call(arr_app, "pageUrl(7, {q: 'pa negre', filter: 'missing', offset: 50})")

    assert plain == "/api/channels/7/catalog"
    assert filtered == "/api/channels/7/catalog?q=pa+negre&filter=missing&offset=50"


@pytest.mark.asyncio
async def test_the_catalog_uses_the_filters_module_and_the_worker_caches_it(arr_app):
    catalog_js = (await arr_app.http.get("/static/js/catalog.js")).raise_for_status().text
    worker = (await arr_app.http.get("/static/sw.js")).raise_for_status().text

    assert 'from "./catalog-filters.js"' in catalog_js
    assert '"/static/js/catalog-filters.js"' in worker
