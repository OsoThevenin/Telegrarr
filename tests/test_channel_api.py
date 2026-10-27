"""Channel API: language and fallback quality are exposed, validated and persisted."""
import types

import httpx
import pytest
import pytest_asyncio

pytest.importorskip("telethon")


class _FakeTelegram:
    def is_connected(self):
        return True

    async def connect(self):
        return None

    async def get_entity(self, chat_id):
        return types.SimpleNamespace(title="Canal")


@pytest_asyncio.fixture()
async def api(fresh_db, monkeypatch):
    from app import auth, tg
    from app.main import app
    monkeypatch.setattr(tg, "_client", _FakeTelegram())
    auth.ensure_default_user()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as client:
        client.cookies.set("telearr_sess", auth.make_cookie("admin"))
        yield client


async def _add(api, **extra):
    r = await api.post("/api/channels", json={"chat_id": -1001, **extra})
    return r


@pytest.mark.asyncio
async def test_new_channel_defaults_to_catalan_1080p(api):
    r = await _add(api)

    assert r.status_code == 200
    assert (r.json()["language"], r.json()["fallback_quality"]) == ("cat", "1080p")


@pytest.mark.asyncio
async def test_add_channel_with_language_and_fallback_quality(api):
    r = await _add(api, language="es", fallback_quality="720p")

    assert (r.json()["language"], r.json()["fallback_quality"]) == ("es", "720p")


@pytest.mark.asyncio
async def test_re_adding_a_channel_keeps_its_language(api):
    await _add(api, language="en")

    r = await _add(api)

    assert r.json()["language"] == "en"


@pytest.mark.asyncio
async def test_patch_channel_language_and_fallback_quality(api):
    cid = (await _add(api)).json()["id"]

    r = await api.patch(f"/api/channels/{cid}", json={"language": "multi", "fallback_quality": "SDTV"})

    assert r.status_code == 200
    assert (r.json()["language"], r.json()["fallback_quality"]) == ("multi", "SDTV")


@pytest.mark.asyncio
@pytest.mark.parametrize("payload", [{"language": "fr"}, {"fallback_quality": "8k"}])
async def test_invalid_language_or_quality_is_rejected(api, payload):
    cid = (await _add(api)).json()["id"]

    r = await api.patch(f"/api/channels/{cid}", json=payload)

    assert r.status_code == 400


@pytest.mark.asyncio
async def test_add_channel_rejects_invalid_language(api):
    r = await _add(api, language="fr")

    assert r.status_code == 400
