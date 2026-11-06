"""Credentials must never reach the container logs (#109)."""
import logging
import socket
import subprocess
import sys
import time

import httpx
import pytest
from fake_tmdb import API_KEY as TMDB_KEY

import app.main  # noqa: F401  (protects the loggers, as at container start)
from app import settings, tmdb
from app.log_redaction import MASK, redact

KEY = "0123456789abcdef0123456789abcdef"
STARTUP_TIMEOUT_S = 30
POLL_INTERVAL_S = 0.1
SHUTDOWN_TIMEOUT_S = 10


@pytest.mark.parametrize("text, expected", [
    (f"/api?mode=queue&apikey={KEY}&output=json", f"/api?mode=queue&apikey={MASK}&output=json"),
    (f"/api/newznab?t=tvsearch&apikey={KEY}", f"/api/newznab?t=tvsearch&apikey={MASK}"),
    (f"/3/find/tt1?api_key={KEY}&external_source=imdb_id",
     f"/3/find/tt1?api_key={MASK}&external_source=imdb_id"),
    (f"/api?APIKEY={KEY}", f"/api?APIKEY={MASK}"),
    (f"for url 'https://tmdb.test/3/find/tt1?api_key={KEY}'", f"for url 'https://tmdb.test/3/find/tt1?api_key={MASK}'"),
])
def test_redact_masks_the_key_and_keeps_the_rest(text, expected):
    assert redact(text) == expected


def test_redact_masks_a_key_nested_in_a_url_encoded_addurl_name():
    # Sonarr posts the NZB link back to the SAB API as the `name` parameter.
    line = ("/api?mode=addurl&name=http%3A%2F%2Ftg%3A8790%2Fapi%2Fnewznab%2Fnzb%3Fid%3D1_2"
            f"%26apikey%3D{KEY}%26x%3D1&apikey={KEY}&output=json")

    assert redact(line) == ("/api?mode=addurl&name=http%3A%2F%2Ftg%3A8790%2Fapi%2Fnewznab%2Fnzb%3Fid%3D1_2"
                            f"%26apikey%3D{MASK}%26x%3D1&apikey={MASK}&output=json")


def test_redact_masks_a_doubly_encoded_key():
    assert KEY not in redact(f"/api?name=http%253A%2F%2Fx%253Fapikey%253D{KEY}%2526a%253D1")


def test_redact_leaves_a_line_without_a_key_alone():
    line = "/api?mode=version&output=json"

    assert redact(line) == line


def _free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def _wait_until_serving(base_url: str, server: subprocess.Popen) -> None:
    deadline = time.monotonic() + STARTUP_TIMEOUT_S
    while time.monotonic() < deadline:
        if server.poll() is not None:
            pytest.fail(f"uvicorn exited early: {server.stdout.read()}")
        try:
            httpx.get(f"{base_url}/api?mode=version")
            return
        except httpx.TransportError:
            time.sleep(POLL_INTERVAL_S)
    pytest.fail("uvicorn did not start in time")


def _container_log_of(*paths: str) -> str:
    """What the container would print for these requests: the real uvicorn command."""
    port = _free_port()
    base_url = f"http://127.0.0.1:{port}"
    server = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app.main:app", "--port", str(port), "--workers", "1",
         "--lifespan", "off"],                  # lifespan would connect to Telegram
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    try:
        _wait_until_serving(base_url, server)
        for path in paths:
            httpx.get(f"{base_url}{path}")
    finally:
        server.terminate()
    output, _ = server.communicate(timeout=SHUTDOWN_TIMEOUT_S)
    return output


def test_arr_requests_never_print_the_key_in_the_access_log():
    nzb_link = f"http%3A%2F%2Ftg%2Fapi%2Fnewznab%2Fnzb%3Fid%3D1_2%26apikey%3D{KEY}"

    log = _container_log_of(f"/api?mode=version&apikey={KEY}&output=json",
                            f"/sabnzbd/api?mode=version&name={nzb_link}&apikey={KEY}",
                            f"/api/newznab?t=caps&apikey={KEY}")

    assert KEY not in log
    assert f"/api?mode=version&apikey={MASK}&output=json" in log   # the request line stays useful
    assert f"/api/newznab?t=caps&apikey={MASK}" in log


@pytest.mark.asyncio
async def test_a_tmdb_request_does_not_log_the_key(fresh_db, fake_tmdb, caplog):
    with caplog.at_level(logging.INFO):
        result = await tmdb.test(TMDB_KEY)

    assert result["ok"]
    assert TMDB_KEY not in caplog.text


@pytest.mark.asyncio
async def test_a_rejected_tmdb_key_is_not_logged_with_the_failure(fresh_db, fake_tmdb, caplog):
    settings.set("tmdb_key", KEY)

    with caplog.at_level(logging.INFO):
        await tmdb.art("tt0000109")

    assert "tmdb art failed for tt0000109" in caplog.text    # the failure stays visible
    assert "401" in caplog.text
    assert KEY not in caplog.text
