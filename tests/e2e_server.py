"""The real FastAPI app for the browser tests: real lifespan, HTTP and database, with
Telegram, TMDB and the *arrs replaced by the same fakes the HTTP tests use.

frontend/playwright.config.ts starts it, and it serves the built UI from
frontend/dist. Each test begins with POST /__e2e__/reset, which only exists here.
"""
import base64
import itertools
import os
import sys
import tempfile
import time
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
from fastapi import HTTPException, Response  # noqa: E402
from fake_arr import PROWLARR_KEY, RADARR_KEY, SONARR_KEY, make_stack, radarr_release  # noqa: E402
from fake_tmdb import API_KEY as TMDB_KEY  # noqa: E402
from fake_tmdb import FakeTMDB  # noqa: E402
from http_harness import FakeTelegram  # noqa: E402

from app import channels, connect, db, settings, tg, tmdb  # noqa: E402
from app.main import app  # noqa: E402

KEPT_TABLES = ("users",)  # so the signed-in session survives a reset
CHAT_ID = -1001234567890
OLD_WORKER = (TESTS_DIR / "old_service_worker.js").read_text(encoding="utf-8")
NOT_FOUND = 404
PENDING_FILES = ("Avatar.2009.1080p.mkv", "Els.Pirates.CAT.mkv", "La.Mosca.1986.mkv")
CATALOG_GIB = 1024 ** 3
CATALOG_FIRST_TMDB = 9001
CATALOG_FILLER_FILMS = 26     # with Pa negre, two pages of 25
FIRST_RADARR_MOVIE = 1        # the first film a test downloads becomes this one in the fake Radarr
CHANNEL_PHOTO = base64.b64decode("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7")  # one pixel


def seed_catalog(channel_id: int) -> None:
    """Cinema Club's Catalog: Pa negre, the newest post, then enough films for a second page."""
    films = [(f"Pel·lícula {n:02}", "720p") for n in range(1, CATALOG_FILLER_FILMS + 1)]
    films.append(("Pa negre", "1080p"))
    with db.conn() as c:
        c.executemany(
            """INSERT INTO releases (channel_id, message_id, title, quality, size, added_at,
                                     movie_tmdb_id, movie_imdb_id, year, movie_title)
               VALUES (?, ?, ?, ?, ?, 1, ?, ?, 2010, ?)""",
            [(channel_id, index + 1, title, quality, 2 * CATALOG_GIB, CATALOG_FIRST_TMDB + index,
              f"tt{CATALOG_FIRST_TMDB + index}", title)
             for index, (title, quality) in enumerate(films)])

_message_ids = itertools.count(1)


def seed() -> None:
    """The world every browser test starts from. Add what a screen needs here."""
    tg._client.add_channel(CHAT_ID, "Cinema Club", username="cinemaclub").photo = CHANNEL_PHOTO
    tg._client.add_channel(-1001234567891, "Sèries CAT", username="seriescat").photo = CHANNEL_PHOTO
    movies = channels.upsert(CHAT_ID, "Cinema Club", kind="movie", poll_minutes=30)
    channels.upsert(-1001234567891, "Sèries CAT", kind="tv", poll_minutes=30)
    # Chats the account is in but Telegrarr does not read yet, for Add channel.
    tg._client.add_channel(-1001234567892, "Merlí 1080p", username="merlicat")
    tg._client.add_group(-1001234567893, "Amics del cinema")
    tg._client.add_forum(-1001234567894, "Anime en català", topics=("Sèries HD", "Pel·lícules HD"))
    tg._client.add_channel(-1001234567895, "Canal Secret", username="canalsecret")
    seed_review(movies["id"])
    seed_catalog(movies["id"])


def seed_review(channel_id: int) -> None:
    settings.set("tmdb_key", TMDB_KEY)
    with db.conn() as c:
        for message_id, file_name in enumerate(PENDING_FILES, start=1):
            c.execute(
                """INSERT INTO pending_review (channel_id, message_id, parsed_title, file_name,
                                               group_key, reason, created_at)
                   VALUES (?, ?, ?, ?, ?, 'review.reason.no_match', ?)""",
                (channel_id, message_id, file_name.split(".")[0], file_name, file_name, message_id),
            )


def fake_tmdb() -> FakeTMDB:
    """What TMDB knows, for the key seed_review stores."""
    fake = FakeTMDB()
    fake.add_movie(19995, titles={"en-US": "Avatar", "ca-ES": "Avatar"}, release_date="2009-12-18",
                   imdb_id="tt0499549")
    fake.add_series(1001, titles={"ca-ES": "Merlí", "en-US": "Merlí"}, first_air_date="2015-09-14",
                    tvdb_id=2001, imdb_id="tt4419684")
    return fake


def install_fakes() -> None:
    tg._client = FakeTelegram()
    tg._dialogs_cache.update(ts=0, data=[])
    tmdb.transport = fake_tmdb().transport
    arrs = make_stack(PROWLARR_KEY, SONARR_KEY, RADARR_KEY)
    arrs.radarr.quality_profiles = [{"id": 4, "name": "HD-1080p"}]
    arrs.radarr.root_folders = [{"id": 1, "path": "/movies", "freeSpace": 1}]
    arrs.radarr.releases = {FIRST_RADARR_MOVIE: [radarr_release(
        "Pa.negre.2010.CATALAN.1080p.WEB-DL.x264-TELEGRARR.a.very.long.release.name.that.has.no.spaces.at.all",
        rejections=("Quality profile does not allow 1080p",))]}
    connect.transport = arrs.transport()


def clear_database() -> None:
    with db.conn() as c:
        rows = c.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()
        tables = [row[0] for row in rows]
        for table in tables:
            if table not in KEPT_TABLES and not table.startswith("sqlite_"):
                c.execute(f'DELETE FROM "{table}"')


_old_worker: set[str] = set()


@app.post("/__e2e__/reset", status_code=204, include_in_schema=False)
def reset() -> None:
    _old_worker.clear()
    for name in settings.ENV_VARS.values():
        os.environ.pop(name, None)
    clear_database()
    install_fakes()
    seed()


@app.post("/__e2e__/downloads", status_code=201, include_in_schema=False)
def add_download(fields: dict) -> dict[str, int]:
    """A row in any state with no transfer behind it, which is why it isn't in seed():
    every other screen starts from an empty list, and the boot would resume queued rows."""
    with db.conn() as c:
        channel = c.execute("SELECT id FROM channels WHERE chat_id = ?", (CHAT_ID,)).fetchone()
        row = {
            "channel_id": channel["id"],
            "message_id": next(_message_ids),
            "created_at": int(time.time()),
            **fields,
        }
        columns = ", ".join(row)
        marks = ", ".join("?" for _ in row)
        created = c.execute(
            f"INSERT INTO downloads ({columns}) VALUES ({marks}) RETURNING id",
            tuple(row.values()),
        ).fetchone()
    return {"id": created["id"]}


@app.post("/__e2e__/downloads/{download_id}/progress", status_code=204, include_in_schema=False)
def set_progress(download_id: int, progress: float) -> None:
    """What a running transfer writes as it goes, for the live stream to pick up."""
    with db.conn() as c:
        c.execute("UPDATE downloads SET progress = ? WHERE id = ?", (progress, download_id))


@app.post("/__e2e__/downloads/{download_id}/message", status_code=204, include_in_schema=False)
def post_message(download_id: int) -> None:
    """The Telegram message behind a row, which Resume and Retry ask for."""
    with db.conn() as c:
        row = c.execute("SELECT message_id, file_name FROM downloads WHERE id = ?", (download_id,)).fetchone()
    tg._client.post(CHAT_ID, text=row["file_name"], file_name=row["file_name"], message_id=row["message_id"])


@app.post("/__e2e__/env", status_code=204, include_in_schema=False)
def set_env(values: dict[str, str]) -> None:
    """Provision settings as a deployment would. Env is read on every lookup; reset() undoes it."""
    os.environ.update(values)


@app.post("/__e2e__/old-worker", status_code=204, include_in_schema=False)
def serve_old_worker(serving: bool) -> None:
    """Whether /sw.js is still the worker that the old UI shipped, as before an upgrade."""
    _old_worker.clear()
    if serving:
        _old_worker.add(OLD_WORKER)


@app.get("/sw.js", include_in_schema=False)
def service_worker() -> Response:
    """Not found, unless a test asks for the old one: the app's 404 handler serves the build."""
    if not _old_worker:
        raise HTTPException(NOT_FOUND)
    return Response(OLD_WORKER, media_type="text/javascript", headers={"Cache-Control": "no-cache"})


def main() -> None:
    db.init()  # the seed needs the tables, and the lifespan only starts with uvicorn
    install_fakes()
    seed()
    uvicorn.run(app, host=LOOPBACK, port=int(os.getenv("E2E_PORT", str(DEFAULT_PORT))))


if __name__ == "__main__":
    main()
