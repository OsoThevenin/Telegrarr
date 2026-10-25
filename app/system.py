# app/system.py — System panel: status/health, scheduled tasks, backups, updates.
import os
import re
import glob
import time
import shutil
import zipfile
import sqlite3
import platform

import httpx

from . import db, settings, __version__ as VERSION
from .i18n import message
from .config import (DATA_DIR, DB_PATH, TV_DIR, MIN_FREE_SPACE_GB,
                     DL_WORKERS, MAX_CONCURRENT_DOWNLOADS)

START_TIME = time.time()
BACKUP_DIR = os.path.join(DATA_DIR, "backups")
GITHUB_REPO = "OsoThevenin/Telegrarr"
_BACKUP_RE = re.compile(r"^telearr-backup-[0-9\-]+\.zip$")


_PARENT_LOOKUPS = 4   # walk up this many levels to find an existing dir to measure


def disk_root() -> str:
    """Where downloads land: the *arr downloads base, or the TV library in standalone mode."""
    return settings.get("downloads_dir") if settings.is_arr_mode() else TV_DIR


def disk_usage() -> dict:
    """Total / used / free bytes of the disk downloads land on (zeros if unmeasurable)."""
    root = disk_root()
    for _ in range(_PARENT_LOOKUPS):
        if os.path.exists(root):
            break
        root = os.path.dirname(root)
    try:
        total, used, free = shutil.disk_usage(root if os.path.exists(root) else "/")
    except OSError:
        total = used = free = 0
    return {"total": total, "used": used, "free": free}


# ── Status / health ───────────────────────────────────────────────────
def _check(check_id: str, ok, bad_level: str, msg: dict) -> dict:
    return {"id": check_id, "ok": bool(ok), "level": "" if ok else bad_level, "message": msg}


def status(authorized: bool, scanner_alive: bool) -> dict:
    disk = disk_usage()
    db_size = os.path.getsize(DB_PATH) if os.path.exists(DB_PATH) else 0
    free_gb = disk["free"] / 1e9
    paused = settings.get_bool("paused", False)
    with db.conn() as c:
        channels = c.execute("SELECT COUNT(*) FROM channels").fetchone()[0]
        enabled = c.execute("SELECT COUNT(*) FROM channels WHERE enabled=1").fetchone()[0]
        db_ok = c.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    disk_ok = free_gb >= MIN_FREE_SPACE_GB
    health = [   # the UI names each check by id (health.<id>) and translates its message
        _check("telegram", authorized, "error", message("health.telegram.ok" if authorized else "health.telegram.off")),
        _check("scanner", scanner_alive, "error",
               message("health.scanner.ok" if scanner_alive else "health.scanner.off")),
        _check("disk", disk_ok, "warn", message("health.disk.ok" if disk_ok else "health.disk.low",
                                                 free=f"{free_gb:.0f}", min=MIN_FREE_SPACE_GB)),
        _check("queue", not paused, "warn", message("health.queue.ok" if not paused else "health.queue.paused")),
        _check("database", db_ok, "error", message("health.database.ok" if db_ok else "health.database.bad",
                                                   size=f"{db_size / 1e6:.1f}")),
    ]
    return {
        "version": VERSION,
        "python": platform.python_version(),
        "platform": f"{platform.system()} {platform.machine()}",
        "uptime_seconds": int(time.time() - START_TIME),
        "started_at": int(START_TIME),
        "data_dir": DATA_DIR,
        "db_size": db_size,
        "disk": disk,
        "channels": channels,
        "channels_enabled": enabled,
        "workers": DL_WORKERS,
        "max_concurrent": MAX_CONCURRENT_DOWNLOADS,
        "health": health,
    }


# ── Scheduled tasks ───────────────────────────────────────────────────
def tasks() -> list:
    now = int(time.time())
    out = []
    with db.conn() as c:
        rows = [dict(r) for r in c.execute(
            "SELECT id, title, poll_minutes, weekdays, enabled, last_scanned_at "
            "FROM channels ORDER BY title COLLATE NOCASE")]
    for r in rows:
        poll = r["poll_minutes"] or 10
        last = r["last_scanned_at"] or 0
        nxt = (last + poll * 60) if last else now
        days = [int(d) for d in str(r["weekdays"] or "").split(",") if d.isdigit() and 0 <= int(d) <= 6]
        out.append({   # the UI words the task ("Scan · title", interval, days) in its language
            "title": r["title"],
            "poll_minutes": poll,
            "weekdays": days,
            "enabled": bool(r["enabled"]),
            "last_run": last or None,
            "next_run": nxt if r["enabled"] else None,
            "channel_id": r["id"],
        })
    return out


# ── Backups ───────────────────────────────────────────────────────────
def _ensure_dir():
    os.makedirs(BACKUP_DIR, exist_ok=True)


def _entry(path: str) -> dict:
    st = os.stat(path)
    return {"name": os.path.basename(path), "size": st.st_size, "created": int(st.st_mtime)}


def list_backups() -> list:
    _ensure_dir()
    files = sorted(glob.glob(os.path.join(BACKUP_DIR, "telearr-backup-*.zip")), reverse=True)
    return [_entry(p) for p in files]


def create_backup() -> dict:
    """Consistent snapshot of the (WAL-mode) DB via SQLite's online backup API,
    zipped into the backups dir. Config lives in the DB, so this captures it too."""
    _ensure_dir()
    stamp = time.strftime("%Y%m%d-%H%M%S", time.localtime())
    name = f"telearr-backup-{stamp}.zip"
    path = os.path.join(BACKUP_DIR, name)
    snap = os.path.join(BACKUP_DIR, f".snapshot-{stamp}.db")
    src = sqlite3.connect(DB_PATH)
    dst = sqlite3.connect(snap)
    try:
        with dst:
            src.backup(dst)
    finally:
        src.close()
        dst.close()
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.write(snap, "telearr.db")
    os.remove(snap)
    _prune()
    db.log("INFO", message("event.backup_created", name=name))
    return _entry(path)


def _prune(keep: int = 10):
    files = sorted(glob.glob(os.path.join(BACKUP_DIR, "telearr-backup-*.zip")), reverse=True)
    for p in files[keep:]:
        try:
            os.remove(p)
        except OSError:
            pass


def backup_path(name: str):
    """Return the on-disk path for a backup, or None if the name is unsafe/missing."""
    if not _BACKUP_RE.match(name or ""):
        return None
    path = os.path.join(BACKUP_DIR, name)
    return path if os.path.exists(path) else None


def delete_backup(name: str) -> bool:
    path = backup_path(name)
    if not path:
        return False
    os.remove(path)
    db.log("INFO", message("event.backup_deleted", name=name))
    return True


# ── Updates ───────────────────────────────────────────────────────────
async def check_updates() -> dict:
    current = VERSION
    latest = None
    url = f"https://github.com/{GITHUB_REPO}/releases"
    error = None
    try:
        async with httpx.AsyncClient(timeout=6) as client:
            r = await client.get(
                f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest",
                headers={"Accept": "application/vnd.github+json"})
        if r.status_code == 200:
            j = r.json()
            latest = (j.get("tag_name") or "").lstrip("v") or None
            url = j.get("html_url") or url
        elif r.status_code == 404:
            error = message("updates.no_releases")
        else:
            error = message("updates.github_http", status=r.status_code)
    except Exception as e:
        error = message("updates.github_unreachable", error=str(e))
    up_to_date = latest is None or latest == current
    return {"current": current, "latest": latest, "up_to_date": up_to_date,
            "url": url, "error": error}
