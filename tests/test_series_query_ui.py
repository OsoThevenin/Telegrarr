"""The series search a new TV channel's dialog prefills: the channel's name without
the quality, language and release words that make TMDB find nothing.

It lives in the pure UI module ``series-query.js``, run in node.
"""
import json

import pytest

from js_module import needs_node, run_module


async def _run(arr_app, expression: str):
    module = (await arr_app.http.get("/static/js/series-query.js")).raise_for_status().text
    return run_module(module, expression)


async def _query(arr_app, channel_title: str) -> str:
    return await _run(arr_app, f"m.seriesQuery({json.dumps(channel_title)})")


@pytest.mark.asyncio
@needs_node
@pytest.mark.parametrize("channel_title, query", [
    ("Naruto Shippuden 1080p", "Naruto Shippuden"),
    ("Naruto Shippuden 720p HD", "Naruto Shippuden"),
    ("Joc de trons CAT", "Joc de trons"),
    ("Dragon Ball Super [VOSE] 1080p", "Dragon Ball Super"),
    ("Merlí | Català | 4K", "Merlí"),
    ("One.Piece.HEVC.x265 - CAST", "One Piece"),
    ("Pokémon (Dual) MULTI SUBS", "Pokémon"),
])
async def test_junk_words_are_stripped_from_the_prefilled_series_search(arr_app, channel_title, query):
    assert await _query(arr_app, channel_title) == query


@pytest.mark.asyncio
@needs_node
@pytest.mark.parametrize("channel_title", ["Catalunya Experience", "Spider-Man", "Subway Stories"])
async def test_words_that_merely_start_like_junk_are_kept(arr_app, channel_title):
    assert await _query(arr_app, channel_title) == channel_title


@pytest.mark.asyncio
@needs_node
@pytest.mark.parametrize("channel_title", ["Cat", "HD", "[VOSE]"])
async def test_a_name_that_is_all_junk_is_prefilled_as_it_is(arr_app, channel_title):
    assert await _query(arr_app, channel_title) == channel_title


@pytest.mark.asyncio
@needs_node
@pytest.mark.parametrize("digits_as_id, flag", [(False, "false"), (True, "true"), (None, "false")])
async def test_the_search_url_reads_digits_as_an_id_only_when_asked(arr_app, digits_as_id, flag):
    url = await _run(arr_app, f"m.seriesSearchUrl('Joc de trons', {json.dumps(digits_as_id)})")

    assert url == f"/api/tmdb/search?q=Joc%20de%20trons&digits_as_id={flag}"


@pytest.mark.asyncio
@needs_node
@pytest.mark.parametrize("results, picked", [
    ([{"tmdb_id": 1399, "exact": True}], 1399),
    ([{"tmdb_id": 1399}], None),
    ([{"tmdb_id": 1399}, {"tmdb_id": 1400}], None),
    ([], None),
])
async def test_only_a_lone_exact_hit_is_picked_at_once(arr_app, results, picked):
    hit = await _run(arr_app, f"m.exactHit({json.dumps(results)})")

    assert (hit and hit["tmdb_id"]) == picked


@pytest.mark.asyncio
@needs_node
@pytest.mark.parametrize("q, bare", [("1399", True), (" 1883 ", True), ("tt0944947", False), ("24 hores", False), ("", False)])
async def test_plain_digits_offer_the_enter_hint(arr_app, q, bare):
    assert await _run(arr_app, f"m.isBareDigits({json.dumps(q)})") is bare


@pytest.mark.asyncio
async def test_the_channel_dialog_uses_the_modules_and_the_worker_caches_them(arr_app):
    views_js = (await arr_app.http.get("/static/js/views.js")).raise_for_status().text
    mapper_js = (await arr_app.http.get("/static/js/series-mapper.js")).raise_for_status().text
    worker = (await arr_app.http.get("/static/sw.js")).raise_for_status().text

    assert 'from "./series-mapper.js"' in views_js
    assert 'from "./series-query.js"' in mapper_js
    assert '"/static/js/series-query.js"' in worker
    assert '"/static/js/series-mapper.js"' in worker
