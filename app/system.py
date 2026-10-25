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
from .config import (DATA_DIR, DB_PATH, TV_DIR, MIN_FREE_SPACE_GB,
                     DL_WORKERS, MAX_CONCURRENT_DOWNLOADS)

START_TIME = time.time()
BACKUP_DIR = os.path.join(DATA_DIR, "backups")
GITHUB_REPO = "OsoThevenin/Telegrarr"
WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
_BACKUP_RE = re.compile(r"^telearr-backup-[0-9\-]+\.zip$")


def _disk():
    root = TV_DIR
    for _ in range(4):
        if os.path.exists(root):
            break
        root = os.path.dirname(root)
    try:
        total, used, free = shutil.disk_usage(root if os.path.exists(root) else "/")
    except Exception:
        total = used = free = 0
    return {"total": total, "used": used, "free": free}


# ── Status / health ───────────────────────────────────────────────────
def status(authorized: bool, scanner_alive: bool) -> dict:
    disk = _disk()
    db_size = os.path.getsize(DB_PATH) if os.path.exists(DB_PATH) else 0
    free_gb = disk["free"] / 1e9
    paused = settings.get_bool("paused", False)
    with db.conn() as c:
        channels = c.execute("SELECT COUNT(*) FROM channels").fetchone()[0]
        enabled = c.execute("SELECT COUNT(*) FROM channels WHERE enabled=1").fetchone()[0]
        db_ok = c.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    health = [
        {"name": "Telegram", "ok": bool(authorized), "level": "" if authorized else "error",
         "message": "Connected" if authorized
                    else "Not connected — downloads are paused until you sign in"},
        {"name": "Scanner", "ok": bool(scanner_alive), "level": "" if scanner_alive else "error",
         "message": "Running" if scanner_alive else "Background scanner is not running"},
        {"name": "Disk space", "ok": free_gb >= MIN_FREE_SPACE_GB,
         "level": "" if free_gb >= MIN_FREE_SPACE_GB else "warn",
         "message": f"{free_gb:.0f} GB free"
                    + ("" if free_gb >= MIN_FREE_SPACE_GB else f" — below the {MIN_FREE_SPACE_GB} GB minimum")},
        {"name": "Download queue", "ok": not paused, "level": "" if not paused else "warn",
         "message": "Active" if not paused else "Paused"},
        {"name": "Database", "ok": db_ok, "level": "" if db_ok else "error",
         "message": f"Healthy · {db_size / 1e6:.1f} MB" if db_ok else "Integrity check failed"},
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
        days = [WEEKDAYS[int(d)] for d in str(r["weekdays"] or "").split(",")
                if d != "" and d.isdigit() and 0 <= int(d) <= 6]
        out.append({
            "name": f"Scan · {r['title']}",
            "interval": f"Every {poll} min",
            "days": "Every day" if len(days) == 7 else ", ".join(days) or "—",
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
    db.log("INFO", f"Backup created: {name}")
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
    db.log("INFO", f"Backup deleted: {name}")
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
            error = "No releases published yet"
        else:
            error = f"GitHub returned HTTP {r.status_code}"
    except Exception as e:
        error = f"Could not reach GitHub: {e}"
    up_to_date = latest is None or latest == current
    return {"current": current, "latest": latest, "up_to_date": up_to_date,
            "url": url, "error": error}
