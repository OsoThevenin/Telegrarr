# app/routes/spa.py — the built React app, under /ui/ while the old UI stays at /.
#
# Built files are public, like /static: they hold no data, and a browser fetches a
# PWA manifest without cookies. The index is the only page, so the login check
# lives on it. Registered paths all live below BASE_PATH, so API, Newznab and SAB
# routes can't be shadowed. Vite content-hashes everything in assets/.
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse, Response

from .. import auth, i18n

BASE_PATH = "/ui"
UI_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"
INDEX = "index.html"
HASHED_ASSETS = "assets/"
SERVICE_UNAVAILABLE = 503
IMMUTABLE = "public, max-age=31536000, immutable"
BUILT_LANG = f'<html lang="{i18n.DEFAULT_LANG}"'

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


def _index(request: Request) -> Response:
    if not auth.cookie_user(request):
        return RedirectResponse("/login", status_code=303)
    index = Path(UI_DIST) / INDEX
    if not index.is_file():
        raise HTTPException(SERVICE_UNAVAILABLE, "The UI is not built: run pnpm build in frontend/")
    # The saved language in <html lang> lets the app start in it without a request.
    page = index.read_text(encoding="utf-8").replace(BUILT_LANG, f'<html lang="{i18n.ui_lang()}"', 1)
    return HTMLResponse(page, headers={"Cache-Control": "no-cache"})


@router.get(BASE_PATH)
async def spa_base() -> RedirectResponse:
    return RedirectResponse(f"{BASE_PATH}/", status_code=308)


@router.get(BASE_PATH + "/{path:path}")
async def spa(path: str, request: Request) -> Response:
    built = _built_file(path)
    if built:
        cache = {"Cache-Control": IMMUTABLE} if path.startswith(HASHED_ASSETS) else None
        return FileResponse(built, headers=cache)
    # A stale tab asking for a chunk of an older build needs a failure, not HTML.
    if path.startswith(HASHED_ASSETS):
        raise HTTPException(404)
    return _index(request)
