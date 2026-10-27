"""Account-safety settings: defaults, poll floor rejection, budget status over HTTP."""
import httpx
import pytest
import pytest_asyncio

pytest.importorskip("telethon")

from app import auth, db, safety, settings  # noqa: E402


def test_safe_defaults(fresh_db):
    pub = settings.public()
    assert pub["dl_workers"] == 4
    assert pub["max_concurrent"] == 2
    assert pub["default_poll_minutes"] == 15
    assert pub["poll_floor_minutes"] == 15
    assert pub["daily_budget_gb"] == 0


@pytest.mark.parametrize("minutes", [15, 30, "20"])
def test_poll_at_or_above_floor_is_accepted(fresh_db, minutes):
    assert settings.apply({"default_poll_minutes": minutes})["default_poll_minutes"] == int(minutes)


@pytest.mark.parametrize("minutes", [14, 1, 0, -5])
def test_poll_below_floor_is_rejected(fresh_db, minutes):
    with pytest.raises(settings.SettingRejected):
        settings.apply({"default_poll_minutes": minutes})
    assert settings.public()["default_poll_minutes"] == 15


def test_rejected_patch_persists_nothing(fresh_db):
    with pytest.raises(settings.SettingRejected):
        settings.apply({"daily_budget_gb": 5, "default_poll_minutes": 5})
    assert settings.public()["daily_budget_gb"] == 0


def test_negative_budget_is_rejected(fresh_db):
    with pytest.raises(settings.SettingRejected):
        settings.apply({"daily_budget_gb": -1})


# ── HTTP ──────────────────────────────────────────────────────────────
class OfflineClient:
    def is_connected(self):
        return False


@pytest_asyncio.fixture()
async def api(fresh_db, monkeypatch):
    from app import tg
    from app.main import app
    monkeypatch.setattr(tg, "_client", OfflineClient())
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t",
                                 cookies={"telearr_sess": auth.make_cookie("admin")}) as client:
        yield client


def _channel(poll=30):
    with db.conn() as c:
        return c.execute("INSERT INTO channels (chat_id,title,kind,poll_minutes,created_at) "
                         "VALUES (-100,'Show','tv',?,0)", (poll,)).lastrowid


@pytest.mark.asyncio
async def test_patch_settings_below_floor_is_400(api):
    r = await api.patch("/api/settings", json={"default_poll_minutes": 5})
    assert r.status_code == 400
    assert r.json()["detail"] == {"key": "err.settings.poll_floor", "params": {"floor": 15}}


@pytest.mark.asyncio
async def test_patch_settings_budget_ok(api):
    r = await api.patch("/api/settings", json={"daily_budget_gb": 20})
    assert r.status_code == 200
    assert r.json()["settings"]["daily_budget_gb"] == 20


@pytest.mark.asyncio
async def test_patch_channel_poll_below_floor_is_400(api):
    cid = _channel()
    r = await api.patch(f"/api/channels/{cid}", json={"poll_minutes": 10})
    assert r.status_code == 400
    with db.conn() as c:
        assert c.execute("SELECT poll_minutes FROM channels WHERE id=?", (cid,)).fetchone()[0] == 30


@pytest.mark.asyncio
async def test_patch_channel_poll_at_floor_ok(api):
    cid = _channel()
    r = await api.patch(f"/api/channels/{cid}", json={"poll_minutes": 15})
    assert r.status_code == 200
    assert r.json()["poll_minutes"] == 15


@pytest.mark.asyncio
async def test_add_channel_poll_below_floor_is_400(api):
    r = await api.post("/api/channels", json={"chat_id": -1001, "poll_minutes": 5})
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_status_reports_budget_pause(api):
    settings.apply({"daily_budget_gb": 1})
    safety.record_download(safety.GB)
    r = await api.get("/api/status")
    assert r.status_code == 200
    body = r.json()["budget"]
    assert body["exhausted"] is True
    assert body["limit_gb"] == 1


def test_legacy_stored_poll_below_floor_reads_as_floor(fresh_db):
    settings.set("default_poll_minutes", "10")      # saved by a pre-floor version
    assert settings.public()["default_poll_minutes"] == 15
