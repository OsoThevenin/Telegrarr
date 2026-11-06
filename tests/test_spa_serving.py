"""The React app at /ui/: FastAPI serves the build, deep links get its index, the
existing login guards it, and API, Newznab and SAB paths are not affected."""
import httpx
import pytest
import pytest_asyncio

from app.routes import spa
from http_harness import BASE_URL

INDEX = '<!doctype html><html lang="ca"><body><div id="root">spa-index</div></body></html>'
BUNDLE = "console.log('bundle');"
BUNDLE_PATH = "assets/index-abc123.js"
DEEP_LINKS = ["channels", "settings/account", "api/status", "no/such/screen"]


@pytest.fixture()
def ui_build(tmp_path, monkeypatch):
    """A stand-in for frontend/dist, with a secret just outside it."""
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text(INDEX)
    (dist / BUNDLE_PATH).write_text(BUNDLE)
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
async def test_the_base_path_serves_the_index_uncached(arr_app, ui_build):
    r = await arr_app.http.get("/ui/")

    assert r.status_code == 200
    assert "spa-index" in r.text
    assert r.headers["content-type"].startswith("text/html")
    assert r.headers["cache-control"] == "no-cache"


@pytest.mark.asyncio
async def test_the_base_path_without_a_slash_redirects_to_it(arr_app, ui_build):
    r = await arr_app.http.get("/ui")

    assert r.status_code == 308
    assert r.headers["location"] == "/ui/"


@pytest.mark.asyncio
@pytest.mark.parametrize("path", DEEP_LINKS)
async def test_deep_links_return_the_index(arr_app, ui_build, path):
    r = await arr_app.http.get(f"/ui/{path}")

    assert r.status_code == 200
    assert "spa-index" in r.text


@pytest.mark.asyncio
async def test_a_built_asset_is_served_as_itself_and_cached_for_good(arr_app, ui_build):
    r = await arr_app.http.get(f"/ui/{BUNDLE_PATH}")

    assert r.status_code == 200
    assert r.text == BUNDLE
    assert "javascript" in r.headers["content-type"]
    assert r.headers["cache-control"] == "public, max-age=31536000, immutable"


@pytest.mark.asyncio
async def test_a_missing_asset_is_a_404_not_the_index(arr_app, ui_build):
    """A stale tab asking for a chunk of an older build must not get HTML back."""
    r = await arr_app.http.get("/ui/assets/index-gone.js")

    assert r.status_code == 404
    assert "spa-index" not in r.text


@pytest.mark.asyncio
@pytest.mark.parametrize("path", ["%2e%2e/secret.txt", "..%2fsecret.txt", "assets/%2e%2e/%2e%2e/secret.txt"])
async def test_paths_cannot_climb_out_of_the_build(arr_app, ui_build, path):
    r = await arr_app.http.get(f"/ui/{path}")

    assert "outside-the-build" not in r.text


@pytest.mark.asyncio
async def test_a_path_with_a_null_byte_is_just_an_unknown_path(arr_app, ui_build):
    r = await arr_app.http.get("/ui/channels%00.js")

    assert r.status_code == 200
    assert "spa-index" in r.text


@pytest.mark.asyncio
@pytest.mark.parametrize("lang", ["ca", "en"])
async def test_the_index_declares_the_saved_language(arr_app, ui_build, lang):
    await arr_app.http.patch("/api/settings", json={"ui_lang": lang})

    page = (await arr_app.http.get("/ui/channels")).text

    assert f'<html lang="{lang}"' in page


@pytest.mark.asyncio
async def test_without_a_build_the_base_path_says_so(arr_app, tmp_path, monkeypatch):
    monkeypatch.setattr(spa, "UI_DIST", tmp_path / "not-built")

    r = await arr_app.http.get("/ui/")

    assert r.status_code == 503
    assert "pnpm build" in r.text


# ── logged out ───────────────────────────────────────────────────────
@pytest.mark.asyncio
@pytest.mark.parametrize("path", ["/ui/", "/ui/channels", "/ui/settings/account", "/ui/index.html"])
async def test_logged_out_visits_are_sent_to_login(fresh_db, ui_build, logged_out, path):
    r = await logged_out.get(path)

    assert r.status_code == 303
    assert r.headers["location"] == "/login"


@pytest.mark.asyncio
async def test_logged_out_a_built_asset_is_public_like_static(fresh_db, ui_build, logged_out):
    """A bundle holds no data, and a browser fetches a PWA manifest without cookies."""
    r = await logged_out.get(f"/ui/{BUNDLE_PATH}")

    assert r.status_code == 200


# ── everything else keeps its route ──────────────────────────────────
@pytest.mark.asyncio
async def test_api_paths_keep_precedence(arr_app, ui_build):
    status = await arr_app.http.get("/api/status")
    unknown = await arr_app.http.get("/api/no-such-endpoint")

    assert status.json()["stats"]["channels"] == 0
    assert unknown.status_code == 404
    assert "spa-index" not in unknown.text


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


@pytest.mark.asyncio
async def test_the_old_ui_stays_at_the_root(arr_app, ui_build):
    page = (await arr_app.http.get("/")).text

    assert "/static/js/main.js" in page
    assert "spa-index" not in page
