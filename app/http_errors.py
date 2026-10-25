# app/http_errors.py — one mapping from an outbound HTTP exchange to a keyed error.
#
# Used by the TMDB and *arr clients so both report network failures, rejected
# keys, HTTP errors and non-JSON bodies the same way: as i18n keys whose params
# never carry exception text (only its type), with the detail logged here.
from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass, field

import httpx

from .i18n import KeyedError

log = logging.getLogger("http")
UNAUTHORIZED = 401
FIRST_ERROR_STATUS = 400


@dataclass(frozen=True)
class ErrorKeys:
    """The keyed error to raise for each failure, and the params they share."""
    error: type[KeyedError]
    unreachable: str
    bad_key: str
    http: str
    not_json: str
    params: dict = field(default_factory=dict)       # every error
    where: dict = field(default_factory=dict)        # only "unreachable" / "not JSON" (where it was asked)
    http_detail: Callable[[httpx.Response], dict] | None = None   # extra params for an HTTP error

    def fail(self, key: str, **extra) -> KeyedError:
        return self.error(key, **{**self.params, **extra})


async def request_json(client: httpx.AsyncClient, keys: ErrorKeys, method: str, url: str, **kwargs) -> object:
    """Send one request; return its decoded JSON body or raise ``keys.error``."""
    try:
        r = await client.request(method, url, **kwargs)
    except httpx.HTTPError as e:
        log.warning("%s %s failed: %s", method, url.split("?")[0], e)
        raise keys.fail(keys.unreachable, **keys.where, error=type(e).__name__) from e
    return decode(r, keys)


def decode(r: httpx.Response, keys: ErrorKeys) -> object:
    """The JSON body of a response, or the keyed error its status / body means."""
    if r.status_code == UNAUTHORIZED:
        raise keys.fail(keys.bad_key)
    if r.status_code >= FIRST_ERROR_STATUS:
        extra = keys.http_detail(r) if keys.http_detail else {}
        raise keys.fail(keys.http, status=r.status_code, **extra)
    try:
        return r.json()
    except ValueError as e:
        log.warning("%s answered a non-JSON body (HTTP %s)", r.request.url.host, r.status_code)
        raise keys.fail(keys.not_json, **keys.where) from e
