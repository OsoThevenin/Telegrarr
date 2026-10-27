# app/routes/common.py — helpers shared by the JSON API routers.
#
# Errors reach the UI as i18n messages ({"key", "params"}) it translates. Routers
# built with `keyed_router()` report a request body that does not fit its model
# the same way (400 err.request.invalid) instead of FastAPI's untranslated 422.
from collections.abc import Callable

from fastapi import APIRouter, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from starlette.responses import Response

from .. import i18n, tmdb

BAD_REQUEST, NOT_FOUND, CONFLICT, TOO_MANY, BAD_GATEWAY = 400, 404, 409, 429, 502

# An id typed by the user: a number or its text; the domain layer validates it
# so a bad one comes back as a keyed error naming the source.
LooseId = int | str | None


def bad(status: int, key: str, **params) -> HTTPException:
    """An HTTP error whose detail is an i18n message the UI translates."""
    return HTTPException(status, i18n.message(key, **params))


def keyed(status: int, e: i18n.KeyedError) -> HTTPException:
    return HTTPException(status, e.message())


def tmdb_failed(e: tmdb.TMDBError) -> HTTPException:
    """TMDB itself failing is a bad gateway; a missing key or an unusable id is the request's fault."""
    return keyed(BAD_GATEWAY if isinstance(e, tmdb.TMDBUnavailable) else BAD_REQUEST, e)


def normalize_chat_id(raw) -> int:
    """Accept -100… , bare channel ids, or @usernames-as-int; return -100 form."""
    try:
        cid = int(raw)
    except (TypeError, ValueError):
        raise bad(BAD_REQUEST, "err.channel.chat_id_numeric")
    if cid > 0 and not str(cid).startswith("100"):
        return int(f"-100{cid}")
    if cid > 0:
        return -cid
    return cid


def normalize_topic_id(raw) -> int | None:
    """A forum topic id (a number or its text, > 0); None/"" means the whole chat."""
    if raw is None or raw == "":
        return None
    if isinstance(raw, bool):
        raise bad(BAD_REQUEST, "err.channel.topic_id_numeric")
    try:
        tid = int(raw)
    except (TypeError, ValueError):
        raise bad(BAD_REQUEST, "err.channel.topic_id_numeric")
    if tid <= 0:
        raise bad(BAD_REQUEST, "err.channel.topic_id_numeric")
    return tid


def _invalid_field(e: RequestValidationError) -> str:
    errors = e.errors()
    loc = errors[0].get("loc", ()) if errors else ()
    return ".".join(str(part) for part in loc if part != "body") or "body"


class KeyedValidationRoute(APIRoute):
    """A route whose body-validation failures are keyed 400s, like its other errors."""

    def get_route_handler(self) -> Callable:
        handler = super().get_route_handler()

        async def keyed_handler(request: Request) -> Response:
            try:
                return await handler(request)
            except RequestValidationError as e:
                raise bad(BAD_REQUEST, "err.request.invalid", field=_invalid_field(e)) from e

        return keyed_handler


def keyed_router() -> APIRouter:
    return APIRouter(route_class=KeyedValidationRoute)
