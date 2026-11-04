"""Tests for the System panel: status/health, scheduled tasks, backups, updates."""
import os

import httpx
import pytest

from app import system


def test_status_shape(fresh_db, monkeypatch):
    monkeypatch.setattr(system, "DB_PATH", fresh_db, raising=False)
    s = system.status(authorized=True, scanner_alive=True)
    assert s["version"] and s["python"]
    assert isinstance(s["uptime_seconds"], int)
    ids = {h["id"] for h in s["health"]}
    assert {"telegram", "scanner", "disk", "queue", "database"} <= ids
    telegram = next(h for h in s["health"] if h["id"] == "telegram")
    assert telegram["ok"] is True
    assert telegram["message"] == {"key": "health.telegram.ok", "params": {}}


def test_status_flags_unauthorized(fresh_db, monkeypatch):
    monkeypatch.setattr(system, "DB_PATH", fresh_db, raising=False)
    s = system.status(authorized=False, scanner_alive=False)
    tg = next(h for h in s["health"] if h["id"] == "telegram")
    sc = next(h for h in s["health"] if h["id"] == "scanner")
    assert tg["ok"] is False and tg["level"] == "error"
    assert sc["ok"] is False


def test_tasks_from_channels(fresh_db):
    from app import db
    with db.conn() as c:
        c.execute(
            "INSERT INTO channels (chat_id, title, kind, weekdays, poll_minutes, enabled, created_at) "
            "VALUES (?,?,?,?,?,?,?)",
            (-100123, "My Show", "tv", "0,1,2,3,4,5,6", 15, 1, 0))
    tasks = system.tasks()
    assert len(tasks) == 1
    t = tasks[0]
    assert t["title"] == "My Show"
    assert t["poll_minutes"] == 15
    assert t["weekdays"] == [0, 1, 2, 3, 4, 5, 6]
    assert t["enabled"] is True
    assert t["next_run"] is not None


def test_backup_create_list_delete(fresh_db, monkeypatch, tmp_path):
    monkeypatch.setattr(system, "DB_PATH", fresh_db, raising=False)
    monkeypatch.setattr(system, "BACKUP_DIR", str(tmp_path / "backups"), raising=False)
    info = system.create_backup()
    assert info["name"].startswith("telearr-backup-") and info["name"].endswith(".zip")
    assert info["size"] > 0

    lst = system.list_backups()
    assert any(b["name"] == info["name"] for b in lst)

    path = system.backup_path(info["name"])
    assert path is not None and os.path.exists(path)

    assert system.delete_backup(info["name"]) is True
    assert system.list_backups() == []


def test_backup_path_rejects_traversal(monkeypatch, tmp_path):
    monkeypatch.setattr(system, "BACKUP_DIR", str(tmp_path), raising=False)
    for evil in ["../telearr.db", "/etc/passwd", "telearr-backup-x.zip/../y", "foo.zip", ""]:
        assert system.backup_path(evil) is None


def test_backup_prune_keeps_latest(fresh_db, monkeypatch, tmp_path):
    monkeypatch.setattr(system, "DB_PATH", fresh_db, raising=False)
    bdir = str(tmp_path / "backups")
    monkeypatch.setattr(system, "BACKUP_DIR", bdir, raising=False)
    os.makedirs(bdir, exist_ok=True)
    # 12 fake older backups + prune keeps 10
    for i in range(12):
        open(os.path.join(bdir, f"telearr-backup-2020010{i:02d}-000000.zip"), "w").close()
    system._prune(keep=10)
    assert len(system.list_backups()) == 10


# ── Updates (issue #55) ───────────────────────────────────────────────
# Driven over HTTP (``arr_app``); GitHub's latest-release endpoint is replaced at
# the httpx transport seam (``app.system.transport``).
RUNNING = "1.1.0"


@pytest.fixture()
def latest_github_release(monkeypatch):
    """Run as v1.1.0; ``latest_github_release("v1.0.2")`` makes GitHub answer with that tag."""
    monkeypatch.setattr(system, "VERSION", RUNNING)

    def install(tag: str):
        def handler(request: httpx.Request) -> httpx.Response:
            assert request.url.path.endswith("/releases/latest")
            return httpx.Response(200, json={
                "tag_name": tag,
                "html_url": f"https://github.com/OsoThevenin/Telegrarr/releases/tag/{tag}"})
        monkeypatch.setattr(system, "transport", httpx.MockTransport(handler))
    return install


async def _updates(arr_app) -> dict:
    return (await arr_app.http.get("/api/system/updates")).raise_for_status().json()


@pytest.mark.asyncio
async def test_an_older_github_release_is_up_to_date(arr_app, latest_github_release):
    latest_github_release("v1.0.2")

    updates = await _updates(arr_app)

    assert updates["current"] == "1.1.0"
    assert updates["latest"] == "1.0.2"
    assert updates["up_to_date"] is True


@pytest.mark.asyncio
async def test_a_newer_github_release_is_an_update(arr_app, latest_github_release):
    latest_github_release("v1.1.1")

    updates = await _updates(arr_app)

    assert updates["latest"] == "1.1.1"
    assert updates["up_to_date"] is False


@pytest.mark.asyncio
async def test_the_same_github_release_is_up_to_date(arr_app, latest_github_release):
    latest_github_release("v1.1.0")

    assert (await _updates(arr_app))["up_to_date"] is True


@pytest.mark.asyncio
async def test_an_unreadable_tag_is_up_to_date(arr_app, latest_github_release):
    latest_github_release("nightly-2026-11-04")

    updates = await _updates(arr_app)

    assert updates["up_to_date"] is True
    assert updates["latest"] is None
    assert updates["error"] is None


@pytest.mark.asyncio
@pytest.mark.parametrize("tag", ["v2.1.0", "v2.2.0", "v2.3.0", "v2.3.1", "v2.3.2", "v2.3.3"])
async def test_an_upstream_telearr_tag_is_never_an_update(arr_app, latest_github_release, tag):
    latest_github_release(tag)

    updates = await _updates(arr_app)

    assert updates["up_to_date"] is True
    assert updates["latest"] is None


@pytest.mark.asyncio
@pytest.mark.parametrize("tag", ["v2.0.0", "v2.4.0"])
async def test_a_telegrarr_major_release_is_an_update(arr_app, latest_github_release, tag):
    latest_github_release(tag)

    updates = await _updates(arr_app)

    assert updates["latest"] == tag.lstrip("v")
    assert updates["up_to_date"] is False


@pytest.mark.asyncio
async def test_an_unreadable_running_version_is_up_to_date(arr_app, latest_github_release, monkeypatch):
    monkeypatch.setattr(system, "VERSION", "1.1.1-dev")
    latest_github_release("v1.1.1")

    assert (await _updates(arr_app))["up_to_date"] is True
