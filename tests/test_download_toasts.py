"""The Downloads view tells the truth about Stop and Retry: it reports when a
Stop found nothing running, when a Retry re-queued nothing, and how many rows a
bulk Retry re-queued, from the server's answer (#30). A failed request (null)
adds nothing: the shared api() helper has already shown its error.

The decisions live in the pure UI module ``download-toasts.js``, run in node
on the shapes the server answers with; every message it names is translated.
"""
import json

import pytest

from js_module import needs_node, run_module

LANGS = ("en", "ca")


async def _toast(arr_app, call: str):
    module = (await arr_app.http.get("/static/js/download-toasts.js")).raise_for_status().text
    return run_module(module, f"m.{call}")


@pytest.mark.asyncio
@needs_node
@pytest.mark.parametrize("answer, expected", [
    ({"ok": False}, {"key": "dl.nothing_to_cancel", "kind": "err"}),
    ({"ok": True}, None),
    (None, None),
], ids=["nothing-running", "stopped", "request-failed"])
async def test_stop_says_when_there_was_nothing_to_cancel(arr_app, answer, expected):
    assert await _toast(arr_app, f"cancelToast({json.dumps(answer)})") == expected


@pytest.mark.asyncio
@needs_node
@pytest.mark.parametrize("answer, expected", [
    ({"ok": True}, {"key": "dl.requeued", "kind": "ok"}),
    ({"ok": False}, {"key": "dl.not_requeued", "kind": "err"}),
    ({"ok": False, "reason": "dl.err.message_gone"}, {"key": "dl.err.message_gone", "kind": "err"}),
    (None, None),
], ids=["re-queued", "not-re-queued", "message-gone", "request-failed"])
async def test_retry_says_requeued_only_when_the_server_re_queued(arr_app, answer, expected):
    assert await _toast(arr_app, f"retryToast({json.dumps(answer)})") == expected


@pytest.mark.asyncio
@needs_node
@pytest.mark.parametrize("answer, expected", [
    ({"ok": True, "count": 2}, {"key": "dl.requeued_n", "params": {"count": 2}, "kind": "ok"}),
    ({"ok": True, "count": 0}, {"key": "dl.not_requeued", "kind": "err"}),
    (None, None),
], ids=["some", "none", "request-failed"])
async def test_bulk_retry_reports_how_many_rows_the_server_re_queued(arr_app, answer, expected):
    assert await _toast(arr_app, f"bulkRetryToast({json.dumps(answer)})") == expected


@pytest.mark.asyncio
@pytest.mark.parametrize("lang", LANGS)
async def test_every_download_toast_is_translated(arr_app, lang):
    strings = (await arr_app.http.get(f"/static/i18n/{lang}.json")).raise_for_status().json()

    keys = ("dl.nothing_to_cancel", "dl.requeued", "dl.not_requeued", "dl.requeued_n")

    assert [k for k in keys if not strings.get(k)] == []
    assert "{count}" in strings["dl.requeued_n"]


@pytest.mark.asyncio
async def test_the_downloads_view_uses_the_toast_decisions(arr_app):
    views = (await arr_app.http.get("/static/js/views.js")).raise_for_status().text

    assert 'from "./download-toasts.js"' in views
    for call in ("cancelToast(", "retryToast(", "bulkRetryToast("):
        assert call in views
