# app/main.py — FastAPI app: auth, pages, and the JSON API.
import os
import json
import asyncio
import logging
import contextlib

from fastapi import FastAPI, Request, Form, Depends, HTTPException
from fastapi.responses import (RedirectResponse, HTMLResponse, JSONResponse,
                               Response, StreamingResponse, FileResponse)
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from . import db, auth, channels, directory, scanner, settings, plex, notify, arr, tmdb, tg, system, connect, safety, __version__
from .tg import get_client
from .namer import imdb_search, LANGUAGE_TOKENS, CHANNEL_QUALITIES
from .config import summary

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("main")

HERE = os.path.dirname(__file__)
templates = Jinja2Templates(directory=os.path.join(HERE, "templates"))


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    db.init()
    auth.ensure_default_user()
    client = get_client()
    try:
        await client.connect()
        if not await client.is_user_authorized():
            db.log("ERROR", "Telegram session not authorized — see README auth step.")
    except Exception as e:
        db.log("ERROR", f"Telegram connect failed at startup: {e}")
    scanner.start_background()
    yield
    # graceful shutdown: requeue anything in flight so it resumes next boot
    scanner.begin_shutdown()
    with contextlib.suppress(Exception):
        with db.conn() as c:
            c.execute("UPDATE downloads SET status='queued', progress=0, speed_mbs=0 "
                      "WHERE status='downloading'")
    with contextlib.suppress(Exception):
        await client.disconnect()


app = FastAPI(title="Telegrarr", version=__version__, lifespan=lifespan)
app.mount("/static", StaticFiles(directory=os.path.join(HERE, "static")), name="static")


# The UI is entirely first-party: templates, /static assets and inline handlers,
# with no CDN or remote XHR. A tight CSP therefore costs nothing and shuts down
# injected-script and clickjacking attempts.
_CSP = ("default-src 'self'; "
        "img-src 'self' data: https:; "        # TMDB artwork is remote
        "script-src 'self' 'unsafe-inline'; "
        "style-src 'self' 'unsafe-inline'; "
        "connect-src 'self'; "
        "frame-ancestors 'none'; "
        "base-uri 'self'; "
        "form-action 'self'")


@app.middleware("http")
async def security_headers(request: Request, call_next):
    resp = await call_next(request)
    resp.headers.setdefault("Content-Security-Policy", _CSP)
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("X-Frame-Options", "DENY")
    resp.headers.setdefault("Referrer-Policy", "no-referrer")
    resp.headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
    resp.headers.setdefault("Permissions-Policy",
                            "geolocation=(), microphone=(), camera=(), interest-cohort=()")
    return resp


# ── auth / pages ──────────────────────────────────────────────────────
@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    if not auth.cookie_user(request):
        return RedirectResponse("/login", status_code=303)
    return templates.TemplateResponse(request, "index.html")


@app.get("/login", response_class=HTMLResponse)
async def login_page(request: Request, error: str = ""):
    return templates.TemplateResponse(request, "login.html", {"error": error})


def _is_secure(request: Request) -> bool:
    """True when the browser reached us over HTTPS, directly or via a proxy."""
    if request.url.scheme == "https":
        return True
    return request.headers.get("x-forwarded-proto", "").split(",")[0].strip() == "https"


@app.post("/login")
async def do_login(request: Request, username: str = Form(...), password: str = Form(...)):
    key = auth.client_key(request)

    wait = auth.throttle_retry_after(key)
    if wait:
        db.log("WARN", f"Login attempt from {key} rejected — locked out for {wait}s")
        return RedirectResponse(
            f"/login?error=Too+many+attempts.+Try+again+in+{wait}+seconds.",
            status_code=303)

    if not auth.verify(username, password):
        auth.record_failure(key)
        db.log("WARN", f"Failed login for '{username}' from {key}")
        return RedirectResponse("/login?error=Invalid+credentials", status_code=303)

    auth.record_success(key)
    r = RedirectResponse("/", status_code=303)
    # secure=True only when the request actually arrived over TLS, so the
    # cookie still works for the common plain-HTTP LAN deployment.
    r.set_cookie("telearr_sess", auth.make_cookie(username),
                 httponly=True, samesite="lax", max_age=7 * 86400,
                 secure=_is_secure(request))
    return r


@app.get("/logout")
async def logout():
    r = RedirectResponse("/login", status_code=303)
    r.delete_cookie("telearr_sess")
    return r


@app.get("/healthz")
async def healthz():
    return {"ok": True}


@app.get("/sw.js")
async def service_worker():
    # Served from the root so its scope covers the whole app (a /static/ path
    # would only control /static/). Service-Worker-Allowed lifts the scope cap.
    return FileResponse(os.path.join(HERE, "static", "sw.js"),
                        media_type="application/javascript",
                        headers={"Service-Worker-Allowed": "/", "Cache-Control": "no-cache"})


def _live_snapshot():
    import shutil
    from .config import TV_DIR
    with db.conn() as c:
        stats = {k: c.execute(q).fetchone()[0] for k, q in {
            "channels": "SELECT COUNT(*) FROM channels",
            "queued": "SELECT COUNT(*) FROM downloads WHERE status='queued'",
            "downloading": "SELECT COUNT(*) FROM downloads WHERE status='downloading'",
            "completed": "SELECT COUNT(*) FROM downloads WHERE status='completed'",
            "failed": "SELECT COUNT(*) FROM downloads WHERE status='failed'",
        }.items()}
        stats["total_size"] = c.execute(
            "SELECT COALESCE(SUM(file_size),0) FROM downloads WHERE status='completed'").fetchone()[0]
        active = [dict(r) for r in c.execute(
            "SELECT d.*, ch.title AS channel_title FROM downloads d "
            "LEFT JOIN channels ch ON ch.id=d.channel_id "
            "WHERE d.status IN ('downloading','queued') ORDER BY d.id")]
    root = TV_DIR
    for _ in range(4):
        if os.path.exists(root):
            break
        root = os.path.dirname(root)
    try:
        total, used, free = shutil.disk_usage(root if os.path.exists(root) else "/")
    except Exception:
        total = used = free = 0
    return {"stats": stats, "active": active, "paused": settings.get_bool("paused", False),
            "budget": safety.budget_status(),
            "disk": {"total": total, "used": used, "free": free},
            "speed": round(sum(a.get("speed_mbs") or 0 for a in active), 1)}


@app.get("/api/events")
async def api_events(request: Request, user=Depends(auth.require_user)):
    """Server-sent events: live stats + active downloads (~1s), for real-time UI."""
    async def gen():
        try:
            while not await request.is_disconnected():
                yield f"data: {json.dumps(_live_snapshot())}\n\n"
                await asyncio.sleep(1.0)
        except asyncio.CancelledError:
            pass
    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no",
                                      "Connection": "keep-alive"})


# ── status ────────────────────────────────────────────────────────────
@app.get("/api/status")
async def api_status(user=Depends(auth.require_user)):
    import shutil
    from .config import TV_DIR
    root = TV_DIR
    for _ in range(4):
        if os.path.ismount(root) or os.path.exists(root):
            break
        root = os.path.dirname(root)
    try:
        total, used, free = shutil.disk_usage(root if os.path.exists(root) else "/")
    except Exception:
        total = used = free = 0
    client = get_client()
    try:
        authed = client.is_connected() and await client.is_user_authorized()
    except Exception:
        authed = False
    with db.conn() as c:
        stats = {k: c.execute(q).fetchone()[0] for k, q in {
            "channels": "SELECT COUNT(*) FROM channels",
            "queued": "SELECT COUNT(*) FROM downloads WHERE status='queued'",
            "downloading": "SELECT COUNT(*) FROM downloads WHERE status='downloading'",
            "completed": "SELECT COUNT(*) FROM downloads WHERE status='completed'",
            "failed": "SELECT COUNT(*) FROM downloads WHERE status='failed'",
        }.items()}
        stats["total_size"] = c.execute(
            "SELECT COALESCE(SUM(file_size),0) FROM downloads WHERE status='completed'").fetchone()[0]
    return {"authorized": authed, "paused": settings.get_bool("paused", False),
            "disk": {"total": total, "used": used, "free": free},
            "stats": stats, "config": summary(), "budget": safety.budget_status()}


# ── system (status / tasks / backups / updates) ───────────────────────
@app.get("/api/system/status")
async def api_system_status(user=Depends(auth.require_user)):
    client = get_client()
    try:
        authed = client.is_connected() and await client.is_user_authorized()
    except Exception:
        authed = False
    return system.status(authed, scanner.is_alive())


@app.get("/api/system/tasks")
async def api_system_tasks(user=Depends(auth.require_user)):
    return system.tasks()


@app.post("/api/system/tasks/scan_all")
async def api_system_scan_all(user=Depends(auth.require_user)):
    client = get_client()
    if not client.is_connected():
        await client.connect()
    with db.conn() as c:
        chans = c.execute("SELECT * FROM channels WHERE enabled=1").fetchall()
    for ch in chans:
        scanner._spawn(scanner.scan_channel(client, ch))
    return {"ok": True, "message": f"Scanning {len(chans)} channel(s)"}


@app.get("/api/system/backups")
async def api_system_backups(user=Depends(auth.require_user)):
    return system.list_backups()


@app.post("/api/system/backups")
async def api_system_backup_create(user=Depends(auth.require_user)):
    return await asyncio.to_thread(system.create_backup)


@app.get("/api/system/backups/{name}/download")
async def api_system_backup_download(name: str, user=Depends(auth.require_user)):
    path = system.backup_path(name)
    if not path:
        raise HTTPException(404)
    return FileResponse(path, media_type="application/zip", filename=name)


@app.delete("/api/system/backups/{name}")
async def api_system_backup_delete(name: str, user=Depends(auth.require_user)):
    if not system.delete_backup(name):
        raise HTTPException(404)
    return {"ok": True}


@app.get("/api/system/updates")
async def api_system_updates(user=Depends(auth.require_user)):
    return await system.check_updates()


# ── channels ──────────────────────────────────────────────────────────
@app.get("/api/channels")
async def api_channels(user=Depends(auth.require_user)):
    with db.conn() as c:
        return [dict(r) for r in c.execute("SELECT * FROM channels ORDER BY id DESC")]


def _normalize_chat_id(raw) -> int:
    """Accept -100… , bare channel ids, or @usernames-as-int; return -100 form."""
    try:
        cid = int(raw)
    except (TypeError, ValueError):
        raise HTTPException(400, "chat_id must be numeric")
    if cid > 0 and not str(cid).startswith("100"):
        return int(f"-100{cid}")
    if cid > 0:
        return -cid
    return cid


_CHANNEL_CHOICES = {"language": tuple(LANGUAGE_TOKENS), "fallback_quality": CHANNEL_QUALITIES}


def _release_fields(payload: dict) -> dict:
    """Validated language / fallback_quality from a channel payload (only keys present)."""
    fields = {k: payload[k] for k in _CHANNEL_CHOICES if payload.get(k) is not None}
    for key, value in fields.items():
        if value not in _CHANNEL_CHOICES[key]:
            raise HTTPException(400, f"{key} must be one of: {', '.join(_CHANNEL_CHOICES[key])}")
    return fields


@app.post("/api/channels")
async def api_add_channel(payload: dict, user=Depends(auth.require_user)):
    if "chat_id" not in payload:
        raise HTTPException(400, "chat_id is required")
    release = _release_fields(payload)
    chat_id = _normalize_chat_id(payload["chat_id"])
    title = payload.get("title") or f"Channel {chat_id}"
    kind = payload.get("kind", "tv")
    weekdays = payload.get("weekdays", channels.ALL_WEEKDAYS)
    try:
        poll = settings.poll_minutes(payload.get("poll_minutes", channels.default_poll_minutes()))
    except settings.SettingRejected as e:
        raise HTTPException(400, str(e))
    try:
        client = get_client()
        if not client.is_connected():
            await client.connect()
        ent = await client.get_entity(chat_id)
        title = getattr(ent, "title", None) or title
    except Exception as e:
        db.log("WARN", f"get_entity failed for {chat_id}: {e}")
    return channels.upsert(chat_id, title, kind=kind, weekdays=weekdays, poll_minutes=poll, release=release)


@app.patch("/api/channels/{cid}")
async def api_patch_channel(cid: int, payload: dict, user=Depends(auth.require_user)):
    allowed = {"title", "kind", "weekdays", "poll_minutes", "enabled", "imdb_id", "imdb_title",
               "language", "fallback_quality"}
    payload = {**payload, **_release_fields(payload)}
    if "poll_minutes" in payload:
        try:
            payload = {**payload, "poll_minutes": settings.poll_minutes(payload["poll_minutes"])}
        except settings.SettingRejected as e:
            raise HTTPException(400, str(e))
    sets = [f"{k}=?" for k in payload if k in allowed]
    vals = [payload[k] for k in payload if k in allowed]
    if not sets:
        return {"ok": True}
    vals.append(cid)
    with db.conn() as c:
        c.execute(f"UPDATE channels SET {','.join(sets)} WHERE id=?", vals)
        ch = c.execute("SELECT * FROM channels WHERE id=?", (cid,)).fetchone()
    if not ch:
        raise HTTPException(404)
    return dict(ch)


@app.put("/api/channels/{cid}/series")
async def api_map_series(cid: int, payload: dict, user=Depends(auth.require_user)):
    """Map a series channel to its TVDB id (+ TMDB/IMDb ids derived via TMDB)."""
    with db.conn() as c:
        if not c.execute("SELECT 1 FROM channels WHERE id=?", (cid,)).fetchone():
            raise HTTPException(404)
    try:
        return await channels.map_series(cid, tmdb_id=payload.get("tmdb_id"), tvdb_id=payload.get("tvdb_id"),
                                         title=payload.get("title") or "")
    except tmdb.TMDBError as e:
        raise HTTPException(400, str(e))


@app.delete("/api/channels/{cid}")
async def api_delete_channel(cid: int, user=Depends(auth.require_user)):
    with db.conn() as c:
        c.execute("DELETE FROM channels WHERE id=?", (cid,))
    return {"ok": True}


@app.post("/api/channels/{cid}/scan")
async def api_scan(cid: int, user=Depends(auth.require_user)):
    with db.conn() as c:
        ch = c.execute("SELECT * FROM channels WHERE id=?", (cid,)).fetchone()
    if not ch:
        raise HTTPException(404)
    client = get_client()
    if not client.is_connected():
        await client.connect()
    scanner._spawn(scanner.scan_channel(client, ch))
    return {"ok": True, "message": "scan started"}


@app.post("/api/channels/{cid}/backfill")
async def api_backfill(cid: int, user=Depends(auth.require_user)):
    with db.conn() as c:
        ch = c.execute("SELECT * FROM channels WHERE id=?", (cid,)).fetchone()
    if not ch:
        raise HTTPException(404)
    client = get_client()
    if not client.is_connected():
        await client.connect()
    scanner._spawn(scanner.backfill_channel(client, ch))
    return {"ok": True, "message": "backfill walking full history — watch Logs."}


# ── downloads ─────────────────────────────────────────────────────────
@app.get("/api/downloads")
async def api_downloads(limit: int = 100, status: str = "",
                        user=Depends(auth.require_user)):
    limit = max(1, min(limit, 1000))
    # season/episode as published (a resolved two-part episode carries the
    # channel's own number in parsed_episode and where it came from in episode_source)
    q = ("SELECT d.*, c.title AS channel_title, r.season, r.episode, r.parsed_episode, r.episode_source "
         "FROM downloads d LEFT JOIN channels c ON c.id=d.channel_id "
         "LEFT JOIN releases r ON r.channel_id=d.channel_id AND r.message_id=d.message_id")
    args = []
    if status:
        q += " WHERE d.status=?"
        args.append(status)
    q += " ORDER BY d.id DESC LIMIT ?"
    args.append(limit)
    with db.conn() as c:
        return [dict(r) for r in c.execute(q, args)]


@app.post("/api/downloads/bulk")
async def api_bulk(payload: dict, user=Depends(auth.require_user)):
    action = payload.get("action")
    ids = payload.get("ids", [])
    if action not in ("cancel", "retry", "delete"):
        raise HTTPException(400, "bad action")
    for i in ids:
        await _single_action(action, int(i))
    return {"ok": True, "count": len(ids)}


async def _single_action(action: str, dl_id: int):
    if action == "cancel":
        scanner.cancel_download(dl_id)
        return
    with db.conn() as c:
        row = c.execute("""SELECT d.*, c.chat_id FROM downloads d
                           JOIN channels c ON c.id=d.channel_id WHERE d.id=?""",
                        (dl_id,)).fetchone()
    if not row:
        return
    if action == "delete":
        with db.conn() as c:
            c.execute("DELETE FROM downloads WHERE id=?", (dl_id,))
        return
    if action == "retry":
        client = get_client()
        if not client.is_connected():
            await client.connect()
        msg = await client.get_messages(row["chat_id"], ids=row["message_id"])
        if msg:
            with db.conn() as c:
                c.execute("UPDATE downloads SET status='queued', error=NULL, progress=0, "
                          "retry_count=0 WHERE id=?", (dl_id,))
            scanner._spawn(scanner._run_download(client, row["channel_id"], msg,
                                                 row["save_path"], row["group_key"]))


@app.post("/api/downloads/{dl_id}/cancel")
async def api_cancel(dl_id: int, user=Depends(auth.require_user)):
    return {"ok": scanner.cancel_download(dl_id)}


@app.post("/api/downloads/{dl_id}/retry")
async def api_retry(dl_id: int, user=Depends(auth.require_user)):
    await _single_action("retry", dl_id)
    return {"ok": True}


@app.delete("/api/downloads/{dl_id}")
async def api_delete_download(dl_id: int, user=Depends(auth.require_user)):
    await _single_action("delete", dl_id)
    return {"ok": True}


@app.get("/api/downloads/{dl_id}/reveal")
async def api_reveal(dl_id: int, user=Depends(auth.require_user)):
    with db.conn() as c:
        row = c.execute("SELECT save_path FROM downloads WHERE id=?", (dl_id,)).fetchone()
    if not row:
        raise HTTPException(404)
    p = row["save_path"]
    return {"path": p, "exists": os.path.exists(p),
            "size": os.path.getsize(p) if os.path.exists(p) else 0}


# ── imdb / logs ───────────────────────────────────────────────────────
@app.get("/api/imdb/search")
async def api_imdb(q: str, user=Depends(auth.require_user)):
    return await imdb_search(q)


@app.get("/api/logs")
async def api_logs(limit: int = 200, channel_id: int = None,
                   user=Depends(auth.require_user)):
    limit = max(1, min(limit, 1000))
    q = "SELECT * FROM logs"
    args = []
    if channel_id is not None:
        q += " WHERE channel_id=?"
        args.append(channel_id)
    q += " ORDER BY id DESC LIMIT ?"
    args.append(limit)
    with db.conn() as c:
        return [dict(r) for r in c.execute(q, args)]


# ── settings ──────────────────────────────────────────────────────────
@app.get("/api/settings")
async def api_get_settings(user=Depends(auth.require_user)):
    return {"settings": settings.public(), "paths": summary(), "user": user,
            "arr": {"apikey": arr.apikey()}}


@app.post("/api/integrations/arr/regenerate")
async def api_arr_regen(user=Depends(auth.require_user)):
    db.log("INFO", "arr API key regenerated")
    return {"apikey": arr.regenerate()}


@app.patch("/api/settings")
async def api_patch_settings(payload: dict, user=Depends(auth.require_user)):
    try:
        return {"ok": True, "settings": settings.apply(payload)}
    except settings.SettingRejected as e:
        raise HTTPException(400, str(e))


# ── Connect page: Prowlarr / Sonarr / Radarr ──────────────────────────
def _arr_app_name(payload: dict) -> str:
    app_name = str(payload.get("app", ""))
    if app_name not in connect.APP_TITLES:
        raise HTTPException(400, "app must be one of prowlarr, sonarr, radarr")
    return app_name


@app.post("/api/connect/test")
async def api_connect_test(payload: dict, user=Depends(auth.require_user)):
    return await connect.check_connection(_arr_app_name(payload))


@app.post("/api/connect/register")
async def api_connect_register(user=Depends(auth.require_user)):
    me_url = settings.get("telegrarr_url", "")
    if not me_url:
        raise HTTPException(400, "Set the Telegrarr URL the *arr apps use to reach Telegrarr first")
    results = await connect.register_all(connect.Telegrarr(url=me_url, apikey=arr.apikey()))
    for res in results:
        if res["status"] == "created":
            db.log("INFO", f"Connect: registered Telegrarr {res['kind']} in {res['app']}")
        elif res["status"] == "error":
            db.log("WARNING", f"Connect: {res['app']} {res['kind']} registration failed: {res['error']}")
    return {"results": results}


@app.post("/api/account/password")
async def api_change_password(payload: dict, user=Depends(auth.require_user)):
    current = payload.get("current", "")
    new = payload.get("new", "")
    if not auth.verify(user, current):
        raise HTTPException(400, "current password is incorrect")
    if len(new) < auth.MIN_PASSWORD_LEN:
        raise HTTPException(
            400, f"new password must be at least {auth.MIN_PASSWORD_LEN} characters")
    auth.set_password(user, new)
    db.log("INFO", "Admin password changed")
    return {"ok": True}


@app.post("/api/account/username")
async def api_change_username(request: Request, payload: dict, user=Depends(auth.require_user)):
    current = payload.get("current", "")
    new = (payload.get("username") or "").strip()
    if not auth.verify(user, current):
        raise HTTPException(400, "current password is incorrect")
    if len(new) < 3:
        raise HTTPException(400, "username must be at least 3 characters")
    if new != user and auth.username_exists(new):
        raise HTTPException(400, "that username is already taken")
    auth.set_username(user, new)
    db.log("INFO", f"Admin username changed to {new}")
    # username change bumps the session epoch (revokes old cookies) — re-issue ours
    r = JSONResponse({"ok": True, "username": new})
    r.set_cookie("telearr_sess", auth.make_cookie(new),
                 httponly=True, samesite="lax", max_age=7 * 86400,
                 secure=_is_secure(request))
    return r


# ── queue control ─────────────────────────────────────────────────────
@app.post("/api/queue/pause")
async def api_pause(user=Depends(auth.require_user)):
    scanner.pause()
    db.log("INFO", "Downloads paused")
    return {"ok": True, "paused": True}


@app.post("/api/queue/resume")
async def api_resume(user=Depends(auth.require_user)):
    await scanner.resume_all()
    db.log("INFO", "Downloads resumed")
    return {"ok": True, "paused": False}


# ── integration tests ─────────────────────────────────────────────────
@app.post("/api/integrations/plex/test")
async def api_plex_test(user=Depends(auth.require_user)):
    return await plex.test()


@app.post("/api/integrations/notify/test")
async def api_notify_test(user=Depends(auth.require_user)):
    return await notify.test()


@app.get("/api/art")
async def api_art(imdb: str = "", user=Depends(auth.require_user)):
    title = ""
    if imdb:
        with db.conn() as c:
            row = c.execute("SELECT imdb_title FROM channels WHERE imdb_id=? LIMIT 1", (imdb,)).fetchone()
        title = (row["imdb_title"] if row else "") or ""
    return await tmdb.art(imdb, title)


@app.get("/api/tmdb/search")
async def api_tmdb_search(q: str = "", user=Depends(auth.require_user)):
    try:
        return await tmdb.search_series(q)
    except tmdb.KeyMissing as e:
        raise HTTPException(400, str(e))
    except tmdb.TMDBError as e:
        raise HTTPException(502, str(e))


@app.post("/api/integrations/tmdb/test")
async def api_tmdb_test(payload: dict = None, user=Depends(auth.require_user)):
    return await tmdb.test((payload or {}).get("key") or None)


# ── directory channel mass import ────────────────────────────────────
@app.post("/api/directory/scan")
async def api_directory_scan(payload: dict, user=Depends(auth.require_user)):
    chat_id = _normalize_chat_id(payload.get("chat_id"))
    client = await tg.authorized_client()
    if not client:
        raise HTTPException(409, "Telegram not connected")
    try:
        return await directory.scan(client, chat_id)
    except directory.ScanRefused as e:
        raise HTTPException(429, str(e))


def _import_item(raw) -> directory.ImportItem:
    if not isinstance(raw, dict):
        raise HTTPException(400, "each channel must be an object")
    return directory.ImportItem(chat_id=_normalize_chat_id(raw.get("chat_id")), title=str(raw.get("title") or ""),
                                tmdb_id=raw.get("tmdb_id"), tvdb_id=raw.get("tvdb_id"),
                                series_title=str(raw.get("series_title") or ""))


@app.post("/api/directory/import")
async def api_directory_import(payload: dict, user=Depends(auth.require_user)):
    raw = payload.get("channels")
    if not isinstance(raw, list) or not raw:
        raise HTTPException(400, "channels must be a non-empty list")
    if len(raw) > directory.MAX_IMPORT_ITEMS:
        raise HTTPException(400, f"at most {directory.MAX_IMPORT_ITEMS} channels per import")
    return {"results": await directory.import_channels([_import_item(r) for r in raw])}


@app.get("/api/telegram/dialogs")
async def api_telegram_dialogs(user=Depends(auth.require_user)):
    return await tg.list_dialogs()


@app.post("/api/telegram/resolve")
async def api_telegram_resolve(payload: dict, user=Depends(auth.require_user)):
    return await tg.resolve(payload.get("query", ""))


# ── interactive Telegram sign-in (web wizard) ─────────────────────────
@app.get("/api/telegram/auth")
async def api_tg_auth(user=Depends(auth.require_user)):
    return await tg.auth_status()


@app.post("/api/telegram/auth/api")
async def api_tg_set_api(payload: dict, user=Depends(auth.require_user)):
    return await tg.set_api(payload.get("api_id"), payload.get("api_hash"))


@app.post("/api/telegram/auth/send_code")
async def api_tg_send_code(payload: dict, user=Depends(auth.require_user)):
    return await tg.send_code(payload.get("phone", ""))


@app.post("/api/telegram/auth/sign_in")
async def api_tg_sign_in(payload: dict, user=Depends(auth.require_user)):
    r = await tg.sign_in_code(payload.get("code", ""))
    if r.get("ok"):
        scanner.start_background()
    return r


@app.post("/api/telegram/auth/password")
async def api_tg_password(payload: dict, user=Depends(auth.require_user)):
    r = await tg.sign_in_password(payload.get("password", ""))
    if r.get("ok"):
        scanner.start_background()
    return r


@app.post("/api/telegram/auth/logout")
async def api_tg_logout(user=Depends(auth.require_user)):
    return await tg.logout()


@app.get("/api/telegram/proxy")
async def api_tg_get_proxy(user=Depends(auth.require_user)):
    return {"proxy": tg.proxy_display()}


@app.post("/api/telegram/proxy")
async def api_tg_set_proxy(payload: dict, user=Depends(auth.require_user)):
    r = await tg.set_proxy(payload.get("proxy", ""))
    if r.get("ok"):
        scanner.start_background()   # reconnected through the proxy — resume scanning
    return r


# ── *arr integration: Newznab indexer ─────────────────────────────────
def _base_url(request: Request) -> str:
    return str(request.base_url).rstrip("/")


@app.get("/api/newznab/api")
@app.get("/api/newznab")
async def newznab(request: Request, t: str = "", apikey: str = "", q: str = "",
                  season: str = "", ep: str = "", imdbid: str = "", tvdbid: str = "",
                  tmdbid: str = "", cat: str = "", limit: int = 100, offset: int = 0):
    if t == "caps":
        return Response(arr.caps_xml(), media_type="application/xml")
    if not arr.check_key(apikey):
        return Response('<?xml version="1.0"?><error code="100" description="Incorrect API key"/>',
                        media_type="application/xml", status_code=401)
    limit = max(1, min(limit, 200))
    rels = arr.search_releases(t or "search", q=q, season=season or None,
                               ep=ep or None, imdbid=imdbid or None, limit=limit,
                               tvdbid=tvdbid or None, tmdbid=tmdbid or None)
    return Response(arr.feed_xml(_base_url(request), rels), media_type="application/xml")


@app.get("/api/newznab/nzb")
async def newznab_nzb(id: str = "", apikey: str = ""):
    if not arr.check_key(apikey):
        raise HTTPException(401, "bad api key")
    try:
        cid, mid = id.split("_")
        cid, mid = int(cid), int(mid)
    except Exception:
        raise HTTPException(400, "bad id")
    return Response(arr.nzb_xml(cid, mid), media_type="application/x-nzb",
                    headers={"Content-Disposition": f'attachment; filename="telearr-{cid}-{mid}.nzb"'})


# ── *arr integration: SABnzbd-compatible download client ──────────────
async def _sab_add(cid, mid):
    if not cid or not mid:
        return None
    dlid = await scanner.grab_message(cid, mid)
    return f"telearr{dlid}" if dlid else None


def _sab_delete(nzo):
    try:
        dlid = int(str(nzo).replace("telearr", ""))
    except (TypeError, ValueError):
        return
    scanner.cancel_download(dlid)
    with db.conn() as c:
        c.execute("UPDATE downloads SET status='cancelled' WHERE id=? AND status IN ('queued','downloading')", (dlid,))


async def _sab(request: Request):
    qp = dict(request.query_params)
    form = await request.form() if request.method == "POST" else {}
    def g(k, d=""):
        return qp.get(k) or (form.get(k) if hasattr(form, "get") else None) or d
    mode = g("mode")
    if mode == "version":
        return JSONResponse(arr.sab_version())
    if not arr.check_key(g("apikey")):
        return JSONResponse({"status": False, "error": "API Key Incorrect"}, status_code=401)
    if mode in ("get_config", "config"):
        return JSONResponse(arr.sab_config())
    if mode == "get_cats":
        return JSONResponse({"categories": arr.sab_categories()})
    if mode == "fullstatus":
        return JSONResponse({"status": arr.sab_queue()["queue"]})
    if mode == "queue":
        if g("name") == "delete":
            _sab_delete(g("value"))
            return JSONResponse({"status": True})
        return JSONResponse(arr.sab_queue())
    if mode == "history":
        if g("name") == "delete":
            _sab_delete(g("value"))
            return JSONResponse({"status": True})
        return JSONResponse(arr.sab_history())
    if mode == "addurl":
        import urllib.parse as up
        rid = (up.parse_qs(up.urlparse(g("name")).query).get("id") or [""])[0]
        cid, mid = arr.parse_ref("telearr:" + rid.replace("_", ":")) if rid else (None, None)
        nzo = await _sab_add(cid, mid)
        return JSONResponse({"status": bool(nzo), "nzo_ids": [nzo] if nzo else []})
    if mode == "addfile":
        f = form.get("name") or form.get("nzbfile") if hasattr(form, "get") else None
        content = (await f.read(1_048_576)).decode("utf-8", "ignore") if f is not None and hasattr(f, "read") else str(f or "")
        cid, mid = arr.parse_ref(content)
        nzo = await _sab_add(cid, mid)
        return JSONResponse({"status": bool(nzo), "nzo_ids": [nzo] if nzo else []})
    return JSONResponse({"status": True})


@app.api_route("/api", methods=["GET", "POST"])
@app.api_route("/sabnzbd/api", methods=["GET", "POST"])
async def sab(request: Request):
    return await _sab(request)
