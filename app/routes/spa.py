# app/routes/spa.py — the built React app, at the root.
#
# Built files are public, like /static: they hold no data, and a browser fetches a
# PWA manifest without cookies. The index is the only page, so the login check
# lives on it. Only what no route claims comes here (see `fallback`), so API, Newznab
# and SAB paths behave as if the app weren't there, slash redirects and 405s included.
# Vite content-hashes everything in assets/; the rest of the build keeps its URL, as
# /sw.js has to, and is revalidated.
from pathlib import Path
from urllib.parse import quote, urlencode

from fastapi import APIRouter, HTTPException, Request
from fastapi.exception_handlers import http_exception_handler
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse, Response

from .. import auth, i18n

OLD_BASE_PATH = "/ui"
UI_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"
INDEX = "index.html"
HASHED_ASSETS = "assets/"
SERVICE_UNAVAILABLE = 503
IMMUTABLE = "public, max-age=31536000, immutable"
REVALIDATE = "no-cache"
BUILT_LANG = f'<html lang="{i18n.DEFAULT_LANG}"'
# Unknown paths under these are real 404s: nobody opens a screen there.
BACKEND_PATHS = frozenset({"api", "sabnzbd", "static"})
PAGE_METHODS = frozenset({"GET", "HEAD"})

router = APIRouter(include_in_schema=False)


def _built_file(path: str) -> Path | None:
    """The file `path` names inside the build, if any. The index doesn't count:
    it always goes through the login check."""
    if "\0" in path:
        return None
    dist = Path(UI_DIST).resolve()
    candidate = (dist / path).resolve()
    if candidate == dist / INDEX or not candidate.is_relative_to(dist):
        return None
    return candidate if candidate.is_file() else None


def _login_redirect(request: Request) -> RedirectResponse:
    """To the login page, which brings the visitor back here afterwards."""
    target = request.scope["path"]
    if request.url.query:
        target = f"{target}?{request.url.query}"
    url = "/login" if target == "/" else f"/login?{urlencode({'next': target})}"
    return RedirectResponse(url, status_code=303)


def _index(request: Request) -> Response:
    if not auth.cookie_user(request):
        return _login_redirect(request)
    index = Path(UI_DIST) / INDEX
    if not index.is_file():
        raise HTTPException(SERVICE_UNAVAILABLE, "The UI is not built: run pnpm build in frontend/")
    # The saved language in <html lang> lets the app start in it without a request.
    page = index.read_text(encoding="utf-8").replace(BUILT_LANG, f'<html lang="{i18n.ui_lang()}"', 1)
    return HTMLResponse(page, headers={"Cache-Control": REVALIDATE})


@router.get("/")
async def root(request: Request) -> Response:
    return _index(request)


@router.get(OLD_BASE_PATH)
@router.get(OLD_BASE_PATH + "/{path:path}")
async def old_base_path(request: Request, path: str = "") -> RedirectResponse:
    """Bookmarks from when the app lived at /ui/. Quoted, and with no leading slashes,
    so that no path can turn the target into another host."""
    target = "/" + quote(path.lstrip("/"))
    if request.url.query:
        target = f"{target}?{request.url.query}"
    return RedirectResponse(target, status_code=308)


async def fallback(request: Request, exc: HTTPException) -> Response:
    """Every 404: a built file, a screen of the app, or a 404 after all."""
    path = request.scope["path"].lstrip("/")
    if request.method not in PAGE_METHODS or path.split("/", 1)[0] in BACKEND_PATHS:
        return await http_exception_handler(request, exc)
    built = _built_file(path)
    if built:
        cache = IMMUTABLE if path.startswith(HASHED_ASSETS) else REVALIDATE
        return FileResponse(built, headers={"Cache-Control": cache})
    # A stale tab asking for a chunk of an older build needs a failure, not HTML.
    if path.startswith(HASHED_ASSETS):
        return await http_exception_handler(request, exc)
    return _index(request)
