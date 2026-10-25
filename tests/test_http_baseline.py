"""HTTP-level checks for the Telegrarr baseline (ticket #14): session cookie
flags, page branding. Drives the real FastAPI app through httpx's ASGI
transport (lifespan is not run, so no Telegram client is started)."""
import httpx
import pytest

ADMIN = "admin"
ADMIN_PASS = "correct-horse-battery"


@pytest.fixture()
def admin(fresh_db, monkeypatch):
    from app import auth
    monkeypatch.setattr(auth, "DEFAULT_USER", ADMIN)
    monkeypatch.setattr(auth, "DEFAULT_PASS", ADMIN_PASS)
    auth.ensure_default_user()
    return auth.make_cookie(ADMIN)


def _client(base_url="http://testserver", cookie=None):
    from app.main import app
    cookies = {"telearr_sess": cookie} if cookie else None
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                             base_url=base_url, cookies=cookies)


async def _change_username(base_url, cookie, headers=None):
    async with _client(base_url, cookie) as c:
        return await c.post("/api/account/username",
                            json={"current": ADMIN_PASS, "username": "newadmin"},
                            headers=headers or {})


@pytest.mark.asyncio
async def test_username_change_cookie_is_secure_over_https(admin):
    r = await _change_username("https://testserver", admin)
    assert r.status_code == 200
    set_cookie = r.headers["set-cookie"].lower()
    assert set_cookie.startswith("telearr_sess=")
    assert "secure" in set_cookie


@pytest.mark.asyncio
async def test_username_change_cookie_is_secure_behind_tls_proxy(admin):
    r = await _change_username("http://testserver", admin,
                               headers={"X-Forwarded-Proto": "https"})
    assert r.status_code == 200
    assert "secure" in r.headers["set-cookie"].lower()


@pytest.mark.asyncio
async def test_username_change_cookie_not_secure_over_plain_http(admin):
    r = await _change_username("http://testserver", admin)
    assert r.status_code == 200
    assert "secure" not in r.headers["set-cookie"].lower()


@pytest.mark.asyncio
async def test_login_page_is_branded_telegrarr(fresh_db):
    async with _client() as c:
        r = await c.get("/login")
    assert r.status_code == 200
    assert "<title>Telegrarr" in r.text


@pytest.mark.asyncio
async def test_app_shell_is_branded_telegrarr(admin):
    async with _client(cookie=admin) as c:
        r = await c.get("/")
    assert r.status_code == 200
    assert "<title>Telegrarr</title>" in r.text
    assert 'apple-mobile-web-app-title" content="Telegrarr"' in r.text
