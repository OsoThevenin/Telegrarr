"""The series search a new TV channel's dialog prefills: the channel's name without
the quality, language and release words that make TMDB find nothing.

It lives in the pure UI module ``series-query.js``, run in node.
"""
import json

import pytest

from js_module import needs_node, run_module


async def _query(arr_app, channel_title: str) -> str:
    module = (await arr_app.http.get("/static/js/series-query.js")).raise_for_status().text
    return run_module(module, f"m.seriesQuery({json.dumps(channel_title)})")


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
async def test_the_channel_dialog_uses_the_module_and_the_worker_caches_it(arr_app):
    views_js = (await arr_app.http.get("/static/js/views.js")).raise_for_status().text
    worker = (await arr_app.http.get("/static/sw.js")).raise_for_status().text

    assert 'from "./series-query.js"' in views_js
    assert '"/static/js/series-query.js"' in worker
