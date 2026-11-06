"""The real FastAPI app for the browser tests: real lifespan, HTTP and database, with
Telegram, TMDB and the *arrs replaced by the same fakes the HTTP tests use.

frontend/playwright.config.ts starts it, and it serves the built UI from
frontend/dist. Each test begins with POST /__e2e__/reset, which only exists here.
"""
import os
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
TESTS_DIR = REPO_ROOT / "tests"
LOOPBACK = "127.0.0.1"
DEFAULT_PORT = 8791

# app.config reads these at import, so they come before any app import.
_data_dir = tempfile.mkdtemp(prefix="telearr-e2e-")
os.environ["TELEARR_DATA_DIR"] = _data_dir
os.environ["TELEARR_LOG_DIR"] = os.path.join(_data_dir, "logs")
os.environ["TELEARR_SECRET_KEY"] = "e2e-secret-key-not-for-production"
os.environ["TELEARR_MIN_FREE_GB"] = "0"
os.environ["TELEARR_DOWNLOADS_DIR"] = os.path.join(_data_dir, "downloads")
for library_dir in ("TV_DIR", "TV_DIR_4K", "MOVIES_DIR", "MOVIES_DIR_4K", "OTHER_DIR"):
    os.environ[f"TELEARR_{library_dir}"] = os.path.join(_data_dir, "media", library_dir)

sys.path[:0] = [str(REPO_ROOT), str(TESTS_DIR)]

import uvicorn  # noqa: E402
from fake_arr import PROWLARR_KEY, RADARR_KEY, SONARR_KEY, make_stack  # noqa: E402
from fake_tmdb import FakeTMDB  # noqa: E402
from http_harness import FakeTelegram  # noqa: E402

from app import channels, connect, db, tg, tmdb  # noqa: E402
from app.main import app  # noqa: E402

KEPT_TABLES = ("users",)  # so the signed-in session survives a reset


def seed() -> None:
    """The world every browser test starts from. Add what a screen needs here."""
    tg._client.add_channel(-1001234567890, "Cinema Club", username="cinemaclub")
    tg._client.add_channel(-1001234567891, "Sèries CAT", username="seriescat")
    channels.upsert(-1001234567890, "Cinema Club", kind="movie", poll_minutes=30)
    channels.upsert(-1001234567891, "Sèries CAT", kind="tv", poll_minutes=30)


def install_fakes() -> None:
    tg._client = FakeTelegram()
    tmdb.transport = FakeTMDB().transport
    connect.transport = make_stack(PROWLARR_KEY, SONARR_KEY, RADARR_KEY).transport()


def clear_database() -> None:
    with db.conn() as c:
        rows = c.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()
        tables = [row[0] for row in rows]
        for table in tables:
            if table not in KEPT_TABLES and not table.startswith("sqlite_"):
                c.execute(f'DELETE FROM "{table}"')


@app.post("/__e2e__/reset", status_code=204, include_in_schema=False)
def reset() -> None:
    clear_database()
    install_fakes()
    seed()


def main() -> None:
    db.init()  # the seed needs the tables, and the lifespan only starts with uvicorn
    install_fakes()
    seed()
    uvicorn.run(app, host=LOOPBACK, port=int(os.getenv("E2E_PORT", str(DEFAULT_PORT))))


if __name__ == "__main__":
    main()
