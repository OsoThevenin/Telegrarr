"""Tests for the System panel: status/health, scheduled tasks, backups."""
import os

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
