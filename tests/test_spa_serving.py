"""The React app at /: FastAPI serves the build, deep links get its index, the login
guards it, old /ui/ paths redirect, and API, Newznab and SAB paths are not affected."""
from urllib.parse import urlsplit

import httpx
import pytest
import pytest_asyncio

from app import auth
from app.routes import spa
from http_harness import BASE_URL

INDEX = '<!doctype html><html lang="ca"><body><div id="root">spa-index</div></body></html>'
BUNDLE = "console.log('bundle');"
BUNDLE_PATH = "assets/index-abc123.js"
WORKER = "// the built service worker"
PASSWORD = "correct horse battery"
DEEP_LINKS = ["channels", "settings/account", "no/such/screen"]


@pytest.fixture()
def ui_build(tmp_path, monkeypatch):
    """A stand-in for frontend/dist, with a secret just outside it."""
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text(INDEX)
    (dist / BUNDLE_PATH).write_text(BUNDLE)
    (dist / "sw.js").write_text(WORKER)
    (tmp_path / "secret.txt").write_text("outside-the-build")
    monkeypatch.setattr(spa, "UI_DIST", dist)
    return dist


@pytest_asyncio.fixture()
async def logged_out():
    from app.main import app

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=BASE_URL) as http:
        yield http


# ── logged in ────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_the_root_serves_the_index_uncached(arr_app, ui_build):
    r = await arr_app.http.get("/")

    assert r.status_code == 200
    assert "spa-index" in r.text
    assert r.headers["content-type"].startswith("text/html")
    assert r.headers["cache-control"] == "no-cache"


@pytest.mark.asyncio
@pytest.mark.parametrize("path", DEEP_LINKS)
async def test_deep_links_return_the_index(arr_app, ui_build, path):
    r = await arr_app.http.get(f"/{path}")

    assert r.status_code == 200
    assert "spa-index" in r.text


@pytest.mark.asyncio
async def test_a_built_asset_is_served_as_itself_and_cached_for_good(arr_app, ui_build):
    r = await arr_app.http.get(f"/{BUNDLE_PATH}")

    assert r.status_code == 200
    assert r.text == BUNDLE
    assert "javascript" in r.headers["content-type"]
    assert r.headers["cache-control"] == "public, max-age=31536000, immutable"


@pytest.mark.asyncio
async def test_the_service_worker_is_served_from_the_root_and_always_revalidated(arr_app, ui_build):
    """Its URL is what an installed app already registered, so an update replaces the old one."""
    r = await arr_app.http.get("/sw.js")

    assert r.status_code == 200
    assert r.text == WORKER
    assert "javascript" in r.headers["content-type"]
    assert r.headers["cache-control"] == "no-cache"


@pytest.mark.asyncio
async def test_a_missing_asset_is_a_404_not_the_index(arr_app, ui_build):
    """A stale tab asking for a chunk of an older build must not get HTML back."""
    r = await arr_app.http.get("/assets/index-gone.js")

    assert r.status_code == 404
    assert "spa-index" not in r.text


@pytest.mark.asyncio
@pytest.mark.parametrize("path", ["%2e%2e/secret.txt", "..%2fsecret.txt", "assets/%2e%2e/%2e%2e/secret.txt"])
async def test_paths_cannot_climb_out_of_the_build(arr_app, ui_build, path):
    r = await arr_app.http.get(f"/{path}")

    assert "outside-the-build" not in r.text


@pytest.mark.asyncio
async def test_a_path_with_a_null_byte_is_just_an_unknown_path(arr_app, ui_build):
    r = await arr_app.http.get("/channels%00.js")

    assert r.status_code == 200
    assert "spa-index" in r.text


@pytest.mark.asyncio
@pytest.mark.parametrize("lang", ["ca", "en"])
async def test_the_index_declares_the_saved_language(arr_app, ui_build, lang):
    await arr_app.http.patch("/api/settings", json={"ui_lang": lang})

    page = (await arr_app.http.get("/channels")).text

    assert f'<html lang="{lang}"' in page


@pytest.mark.asyncio
async def test_without_a_build_the_root_says_so(arr_app, tmp_path, monkeypatch):
    monkeypatch.setattr(spa, "UI_DIST", tmp_path / "not-built")

    r = await arr_app.http.get("/")

    assert r.status_code == 503
    assert "pnpm build" in r.text


# ── old /ui/ bookmarks ───────────────────────────────────────────────
@pytest.mark.asyncio
@pytest.mark.parametrize("old, new", [
    ("/ui", "/"),
    ("/ui/", "/"),
    ("/ui/channels", "/channels"),
    ("/ui/settings/account", "/settings/account"),
    ("/ui/downloads?tab=failed", "/downloads?tab=failed"),
])
async def test_old_ui_paths_redirect_to_their_new_place(arr_app, ui_build, old, new):
    r = await arr_app.http.get(old, follow_redirects=False)

    assert r.status_code == 308
    assert r.headers["location"] == new


@pytest.mark.asyncio
async def test_the_redirect_needs_no_session(fresh_db, ui_build, logged_out):
    r = await logged_out.get("/ui/channels")

    assert r.status_code == 308
    assert r.headers["location"] == "/channels"


@pytest.mark.asyncio
@pytest.mark.parametrize("path", ["/ui//evil.example", "/ui/%2F/evil.example", "/ui/%5Cevil.example", "/ui/%09/evil.example"])
async def test_the_redirect_stays_on_this_host(arr_app, ui_build, path):
    location = (await arr_app.http.get(path, follow_redirects=False)).headers["location"]

    assert location.startswith("/")
    assert not location.startswith(("//", "/\\"))
    assert urlsplit(location).netloc == ""
    assert "\t" not in location and "\\" not in location


# ── logged out ───────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_a_logged_out_visit_to_the_root_is_sent_to_login(fresh_db, ui_build, logged_out):
    r = await logged_out.get("/")

    assert r.status_code == 303
    assert r.headers["location"] == "/login"


@pytest.mark.asyncio
async def test_the_index_file_is_behind_the_login_too(fresh_db, ui_build, logged_out):
    r = await logged_out.get("/index.html")

    assert r.status_code == 303


@pytest.mark.asyncio
@pytest.mark.parametrize("path", ["/channels", "/settings/account", "/downloads?tab=failed"])
async def test_a_logged_out_deep_link_is_sent_to_login(fresh_db, ui_build, logged_out, path):
    r = await logged_out.get(path)

    assert r.status_code == 303
    assert r.headers["location"] == "/login"


@pytest.mark.asyncio
async def test_logged_out_a_built_asset_is_public_like_static(fresh_db, ui_build, logged_out):
    """A bundle holds no data, and a browser fetches a PWA manifest without cookies."""
    r = await logged_out.get(f"/{BUNDLE_PATH}")

    assert r.status_code == 200


# ── signing in ───────────────────────────────────────────────────────
async def _submit_login(http, password=PASSWORD, **fields):
    form = {"username": "admin", "password": password, **fields}
    return await http.post("/login", data=form, follow_redirects=False)


@pytest.fixture()
def admin_account(fresh_db, monkeypatch):
    monkeypatch.setattr(auth, "DEFAULT_PASS", PASSWORD)
    auth.ensure_default_user()


@pytest.mark.asyncio
async def test_signing_in_lands_on_the_app(admin_account, logged_out):
    r = await _submit_login(logged_out)

    assert r.status_code == 303
    assert r.headers["location"] == "/"


@pytest.mark.asyncio
async def test_the_login_page_has_no_return_address(fresh_db, logged_out):
    page = (await logged_out.get("/login", params={"next": "/channels"})).text

    assert 'name="next"' not in page


@pytest.mark.asyncio
async def test_signing_in_ignores_a_return_address(admin_account, logged_out):
    r = await _submit_login(logged_out, next="/downloads?tab=failed")

    assert r.headers["location"] == "/"


@pytest.mark.asyncio
async def test_a_failed_login_stays_on_the_login_page(admin_account, logged_out):
    r = await _submit_login(logged_out, password="wrong", next="/channels")

    assert r.headers["location"] == "/login?error=invalid"


@pytest.mark.asyncio
@pytest.mark.parametrize("path", ["/login", "/healthz"])
async def test_pages_of_the_backend_keep_precedence(arr_app, ui_build, path):
    r = await arr_app.http.get(path)

    assert r.status_code == 200
    assert "spa-index" not in r.text


@pytest.mark.asyncio
async def test_api_paths_keep_precedence(arr_app, ui_build):
    status = await arr_app.http.get("/api/status")
    unknown = await arr_app.http.get("/api/no-such-endpoint")

    assert status.json()["stats"]["channels"] == 0
    assert unknown.status_code == 404
    assert "detail" in unknown.json()


@pytest.mark.asyncio
async def test_an_unknown_api_path_is_a_404_even_when_logged_out(fresh_db, ui_build, logged_out):
    r = await logged_out.get("/api/no-such-endpoint")

    assert r.status_code == 404


@pytest.mark.asyncio
async def test_a_wrong_method_stays_a_405(arr_app, ui_build):
    r = await arr_app.http.put("/api/status")

    assert r.status_code == 405


@pytest.mark.asyncio
async def test_an_api_path_with_a_trailing_slash_still_redirects_to_its_route(arr_app, ui_build):
    """Sonarr and Radarr keep what the operator typed, so a stray slash has to go on working."""
    params = {"mode": "version", "output": "json", "apikey": arr_app.apikey}

    r = await arr_app.http.get("/sabnzbd/api/", params=params, follow_redirects=True)

    assert r.status_code == 200
    assert "version" in r.json()


@pytest.mark.asyncio
async def test_a_write_to_an_unknown_path_is_a_404_not_the_app(arr_app, ui_build):
    r = await arr_app.http.post("/channels")

    assert r.status_code == 404
    assert "spa-index" not in r.text


@pytest.mark.asyncio
async def test_a_missing_static_file_is_a_404_not_the_app(arr_app, ui_build):
    r = await arr_app.http.get("/static/js/main.js")

    assert r.status_code == 404
    assert "spa-index" not in r.text


@pytest.mark.asyncio
async def test_an_unknown_sab_path_is_a_404_not_the_app(arr_app, ui_build):
    r = await arr_app.http.get("/sabnzbd/no-such-path")

    assert r.status_code == 404
    assert "spa-index" not in r.text


@pytest.mark.asyncio
async def test_newznab_keeps_precedence(arr_app, ui_build):
    r = await arr_app.http.get("/api/newznab", params={"t": "caps", "apikey": arr_app.apikey})

    assert r.status_code == 200
    assert "<caps>" in r.text


@pytest.mark.asyncio
@pytest.mark.parametrize("path", ["/api", "/sabnzbd/api"])
async def test_sab_keeps_precedence(arr_app, ui_build, path):
    r = await arr_app.http.get(path, params={"mode": "version", "output": "json", "apikey": arr_app.apikey})

    assert r.status_code == 200
    assert "version" in r.json()
