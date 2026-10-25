# app/arr.py — *arr stack integration: Newznab indexer + SABnzbd download client.
#
# Sonarr/Radarr/Prowlarr add Telegrarr as a Newznab indexer (search Telegram channels
# as "releases") and as a SABnzbd download client (hand grabs to Telegrarr, which
# downloads from Telegram and reports the finished path back for import).
import os
import time
import html
import re
import secrets
from . import db, settings, __version__ as VERSION

SAB_VERSION = "4.2.0"        # advertise a modern SABnzbd to the *arr clients


# ── API key (shared with the *arr apps; not a web-session secret) ─────
def apikey() -> str:
    k = settings.get("arr_apikey", "")
    if not k:
        k = secrets.token_hex(16)
        settings.set("arr_apikey", k)
    return k


def regenerate() -> str:
    k = secrets.token_hex(16)
    settings.set("arr_apikey", k)
    return k


def check_key(k) -> bool:
    return bool(k) and secrets.compare_digest(str(k), apikey())


def _parent_cat(kind) -> int:
    return 2000 if kind == "movie" else 5000


def _subcat(kind, quality) -> int:
    uhd = str(quality or "").lower() in ("2160p", "4k", "uhd")
    if kind == "movie":
        return 2045 if uhd else 2040
    return 5045 if uhd else 5040


# ── Newznab indexer ───────────────────────────────────────────────────
def caps_xml() -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<caps>'
        f'<server title="Telegrarr" version="{VERSION}"/>'
        '<limits max="100" default="100"/>'
        '<retention days="9999"/>'
        '<searching>'
        # advertise ONLY params we actually honor (advertising ignored params is a
        # spec anti-pattern that can make categorized test searches misbehave)
        '<search available="yes" supportedParams="q"/>'
        '<tv-search available="yes" supportedParams="q,season,ep,tvdbid,tmdbid,imdbid"/>'
        '<movie-search available="yes" supportedParams="q,tmdbid,imdbid"/>'
        '</searching>'
        '<categories>'
        '<category id="2000" name="Movies">'
        '<subcat id="2030" name="Movies/SD"/><subcat id="2040" name="Movies/HD"/><subcat id="2045" name="Movies/UHD"/>'
        '</category>'
        '<category id="5000" name="TV">'
        '<subcat id="5030" name="TV/SD"/><subcat id="5040" name="TV/HD"/><subcat id="5045" name="TV/UHD"/>'
        '</category>'
        '</categories>'
        '</caps>'
    )


def _norm_imdb(imdbid) -> str:
    return "tt" + str(imdbid).strip().lstrip("t")


def _as_int(value) -> int | None:
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def _id_filter(tvdbid, tmdbid, imdbid):
    """Predicate over a release row for the Newznab id params given (None = no filter)."""
    wanted = []
    if tvdbid not in (None, ""):
        wanted.append(("tvdb_id", _as_int(tvdbid)))
    if tmdbid not in (None, ""):
        wanted.append(("tmdb_id", _as_int(tmdbid)))
    if imdbid not in (None, ""):
        wanted.append(("imdb_id", _norm_imdb(imdbid)))
    return lambda r: all(want is not None and r[col] == want for col, want in wanted)


def search_releases(t="search", q="", season=None, ep=None, imdbid=None, limit=100,
                    tvdbid=None, tmdbid=None):
    matches_ids = _id_filter(tvdbid, tmdbid, imdbid)
    with db.conn() as c:
        rows = c.execute(
            """SELECT r.*, ch.title AS chtitle, ch.imdb_title, ch.imdb_id, ch.kind,
                      ch.tvdb_id, ch.tmdb_id
               FROM releases r JOIN channels ch ON ch.id = r.channel_id
               WHERE ch.enabled = 1
               ORDER BY r.season DESC, r.episode DESC, r.added_at DESC
               LIMIT 2000""").fetchall()
    ql = (q or "").strip().lower()
    want_movie = t in ("movie", "moviesearch")
    want_tv = t in ("tvsearch", "tv-search", "tv")
    out = []
    for r in rows:
        kind = r["kind"] or "tv"
        if want_movie and kind != "movie":
            continue
        if want_tv and kind == "movie":
            continue
        if not matches_ids(r):
            continue
        show = (r["imdb_title"] or r["chtitle"] or "").lower()
        if ql and ql not in show and ql not in (r["title"] or "").lower():
            continue
        if season not in (None, "") and r["season"] is not None and int(season) != r["season"]:
            continue
        if ep not in (None, "") and r["episode"] is not None and int(ep) != r["episode"]:
            continue
        out.append(r)
        if len(out) >= limit:
            break
    return out


def _id_attrs(r) -> str:
    """Newznab id attrs so Sonarr/Radarr can map a release by id, not by title."""
    keys = r.keys()
    ids = (("tvdbid", r["tvdb_id"] if "tvdb_id" in keys else None),
           ("tmdbid", r["tmdb_id"] if "tmdb_id" in keys else None),
           ("imdb", (r["imdb_id"] or "").removeprefix("tt") if "imdb_id" in keys else None))
    return "".join(f'<newznab:attr name="{name}" value="{html.escape(str(v))}"/>' for name, v in ids if v)


def feed_xml(base: str, releases) -> str:
    key = apikey()
    items = []
    for r in releases:
        parent, sub = _parent_cat(r["kind"]), _subcat(r["kind"], r["quality"])
        dl = html.escape(f"{base}/api/newznab/nzb?id={r['channel_id']}_{r['message_id']}&apikey={key}")
        size = r["size"] or 0
        pub = time.strftime("%a, %d %b %Y %H:%M:%S +0000", time.gmtime(r["added_at"] or time.time()))
        items.append(
            f'<item><title>{html.escape(r["title"] or "Unknown")}</title>'
            f'<guid isPermaLink="false">telearr-{r["channel_id"]}-{r["message_id"]}</guid>'
            f'<link>{dl}</link><pubDate>{pub}</pubDate>'
            f'<enclosure url="{dl}" length="{size}" type="application/x-nzb"/>'
            f'<category>{parent}</category>'
            f'<newznab:attr name="category" value="{parent}"/>'
            f'<newznab:attr name="category" value="{sub}"/>'
            f'<newznab:attr name="size" value="{size}"/>{_id_attrs(r)}</item>')
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<rss version="2.0" xmlns:newznab="http://www.newznab.com/DTD/2010/feeds/attributes/">'
        '<channel><title>Telegrarr</title><description>Telegram releases</description>'
        f'<newznab:response offset="0" total="{len(items)}"/>'
        f'{"".join(items)}</channel></rss>')


def nzb_xml(channel_id, message_id) -> str:
    ref = f"telearr:{channel_id}:{message_id}"
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<nzb xmlns="http://www.newzbin.com/DTD/2003/nzb">'
        f'<head><meta type="telearr">{ref}</meta></head>'
        f'<file poster="telearr@telearr" date="{int(time.time())}" subject="{ref}">'
        '<groups><group>alt.binaries.telearr</group></groups>'
        f'<segments><segment bytes="1" number="1">{ref}@telearr</segment></segments>'
        '</file></nzb>')


def parse_ref(text):
    m = re.search(r"telearr:(\d+):(\d+)", text or "")
    return (int(m.group(1)), int(m.group(2))) if m else (None, None)


# ── SABnzbd-compatible download client ────────────────────────────────
def sab_categories():
    return ["*", "tv", "movies", "other"]


def _mb(b):
    return round((b or 0) / 1e6, 2)


def category_for(kind) -> str:
    """SAB category (and *arr download folder) for a channel kind."""
    return "movies" if kind == "movie" else "tv"


def storage_path(save_path) -> str:
    """What SAB reports as a job's storage: the release folder for flat *arr grabs
    (Sonarr/Radarr import the folder), the file itself for library-layout downloads
    (whose folder holds other episodes)."""
    save_path = save_path or ""
    root = os.path.realpath(settings.arr_root())
    if save_path and os.path.commonpath([root, os.path.realpath(save_path)]) == root:
        return os.path.dirname(save_path)
    return save_path


def sab_version():
    return {"version": SAB_VERSION}


def sab_config():
    # Sonarr/Radarr deserialize config.categories into SabnzbdCategory objects,
    # so each entry MUST be an object with at least a "name" (not a bare string).
    cats = [{"name": n, "order": i, "dir": "", "pp": "", "script": "Default",
             "newzbin": "", "priority": 0}
            for i, n in enumerate(sab_categories())]
    return {"config": {
        "misc": {"complete_dir": settings.arr_root(), "pre_check": 0, "history_retention": "",
                 "enable_tv_sorting": 0, "enable_movie_sorting": 0, "enable_date_sorting": 0},
        "categories": cats,
        "sorters": [],
    }}


def sab_queue():
    with db.conn() as c:
        rows = c.execute("""SELECT d.*, ch.kind FROM downloads d JOIN channels ch ON ch.id = d.channel_id
                            WHERE d.status IN ('downloading','queued') ORDER BY d.id""").fetchall()
    slots = []
    for r in rows:
        size = r["file_size"] or 0
        prog = r["progress"] or 0
        left = size * (1 - prog)
        slots.append({
            "nzo_id": f"telearr{r['id']}",
            "filename": (r["save_path"] or r["file_name"] or "").split("/")[-1],
            "cat": category_for(r["kind"]),
            "storage": storage_path(r["save_path"]),
            "status": "Downloading" if r["status"] == "downloading" else "Queued",
            "index": len(slots), "percentage": str(int(prog * 100)),
            "mb": str(_mb(size)), "mbleft": str(_mb(left)),
            "size": f"{size / 1e9:.2f} GB", "sizeleft": f"{left / 1e9:.2f} GB",
            "timeleft": "0:00:00", "priority": "Normal", "missing": 0,
        })
    return {"queue": {"paused": settings.get_bool("paused", False), "slots": slots,
                      "speed": "0", "speedlimit": "0", "noofslots": len(slots),
                      "diskspacetotal1": "1000", "diskspace1": "500"}}


def sab_history(limit=100):
    with db.conn() as c:
        rows = c.execute("""SELECT d.*, ch.kind FROM downloads d JOIN channels ch ON ch.id = d.channel_id
                            WHERE d.status IN ('completed','failed') ORDER BY d.id DESC LIMIT ?""",
                         (limit,)).fetchall()
    slots = []
    for r in rows:
        ok = r["status"] == "completed"
        storage = storage_path(r["save_path"])
        name = (r["save_path"] or r["file_name"] or "").split("/")[-1]
        slots.append({
            "nzo_id": f"telearr{r['id']}",
            "name": name, "nzb_name": r["file_name"] or name,
            "category": category_for(r["kind"]),
            "status": "Completed" if ok else "Failed",
            "storage": storage, "path": storage,
            "bytes": r["file_size"] or 0,
            "fail_message": "" if ok else (r["error"] or "failed"),
            "download_time": 0, "postproc_time": 0, "action_line": "",
            "completed": r["finished_at"] or int(time.time()),
        })
    return {"history": {"slots": slots, "noofslots": len(slots)}}
