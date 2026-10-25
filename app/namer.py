# app/namer.py — filename/caption parsing, IMDb lookup, path building.
# v2 changes vs v1:
#   * season/episode regexes accept _ . - as separators (underscore filenames)
#   * quality detection drives 1080p-vs-4K library routing
#   * episode-title cleanup strips trailing codec/junk tokens
import re
import os
import json
import asyncio
import logging
import unicodedata
import urllib.parse
import urllib.request

log = logging.getLogger("namer")

_SEP = r"[\s._\-]*"
SEASON_EP_RE = re.compile(rf"S{_SEP}(\d{{1,2}}){_SEP}E{_SEP}(\d{{1,3}})", re.I)
ALT_SE_RE = re.compile(r"(?:^|\D)(\d{1,2})\s*x\s*(\d{1,3})(?:\D|$)")
EP_ONLY_RE = re.compile(rf"\bEp(?:isode)?{_SEP}(\d{{1,3}})\b", re.I)
SEASON_EPISODE_WORD_RE = re.compile(
    rf"Season{_SEP}(\d{{1,2}}){_SEP}Episode{_SEP}(\d{{1,3}})", re.I)
DATE_RE = re.compile(r"(20\d{2})[.\-_ ](\d{1,2})[.\-_ ](\d{1,2})")
# underscore/dot are word chars, so \b fails around them — use explicit boundaries
QUALITY_RE = re.compile(r"(?<![a-z0-9])(2160p|1440p|1080p|720p|480p|4k|uhd)(?![a-z0-9])", re.I)

_UHD = {"2160p", "4k", "uhd"}


def is_uhd(quality: str | None) -> bool:
    return bool(quality) and quality.lower() in _UHD


def clean_title(text: str) -> str:
    t = re.sub(r"[\[\(][^\]\)]*[\]\)]", " ", text or "")
    t = re.sub(r"[._\-]+", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def extract_episode(text: str) -> dict:
    """Best-effort {season, episode, date, quality}."""
    out = {"season": None, "episode": None, "date": None, "quality": None}
    if not text:
        return out
    for rx in (SEASON_EPISODE_WORD_RE, SEASON_EP_RE, ALT_SE_RE):
        m = rx.search(text)
        if m:
            out["season"], out["episode"] = int(m.group(1)), int(m.group(2))
            break
    else:
        m = EP_ONLY_RE.search(text)
        if m:
            out["episode"] = int(m.group(1))
    d = DATE_RE.search(text)
    if d:
        out["date"] = f"{d.group(1)}-{int(d.group(2)):02d}-{int(d.group(3)):02d}"
    q = QUALITY_RE.search(text)
    if q:
        out["quality"] = q.group(1).lower()
    return out


_JUNK = [
    r"\b(mp4|mkv|avi|mov|webm|m4v|flv|wmv|ts|3gp)\b",
    r"\b(2160p|1440p|1080p|720p|480p|360p|4k|uhd|hd|sd)\b",
    r"\b(x[\s._-]?26[45]|h[\s._-]?26[45]|hevc|avc|aac2?|ac3|dd5?\.?1|mp3|opus)\b",
    r"\b(web[\s-]?dl|web[\s-]?rip|hdrip|hdtv|dvdrip|bluray|brrip|amzn|nf|dsnp|"
    r"hmax|hotstar|jio(cinema)?|voot|mx|sony(liv)?|jstar|jh|netflix|hulu|disney\+?)\b",
    r"\b(hindi|english|tamil|telugu|dual audio|multi audio|subs?)\b",
    r"\b\d+(\.\d+)?\s*(mb|gb|kbps|fps)\b",
]


def extract_episode_title(msg_text: str, filename: str, season: int, episode: int,
                          show_title: str = "") -> str:
    src = (msg_text or "").strip() or (filename or "")
    if not src:
        return ""
    src = unicodedata.normalize("NFKD", src)
    line = ""
    for ln in src.split("\n"):
        ln = ln.strip()
        if not ln:
            continue
        if re.match(r"^(title|file|name|size|quality|audio|video|language|season|"
                    r"episode|ep)\s*[:：\-]?\s*$", ln, re.I):
            continue
        line = ln
        break
    if not line:
        line = src.split("\n")[0]
    line = re.sub(r"^[^\w]*\b(title|file|name)\b\s*[:：\-—]?\s*", "", line, flags=re.I)
    line = re.sub(r"https?://\S+", " ", line)
    line = re.sub(r"[@#]\w+", " ", line)
    line = re.sub(r"[\[\(\{][^\]\)\}]{0,80}[\]\)\}]", " ", line)
    line = re.sub(r"[._\-|:·•]+", " ", line)
    for rx in (SEASON_EP_RE, SEASON_EPISODE_WORD_RE, ALT_SE_RE, EP_ONLY_RE):
        line = rx.sub(" ", line)
    for pat in _JUNK:
        line = re.sub(pat, " ", line, flags=re.I)
    for st in filter(None, [show_title, re.sub(r"\s+", " ", show_title or "")]):
        line = re.sub(re.escape(st).replace(r"\ ", r"[\s_]+"), " ", line, flags=re.I)
    line = re.sub(r"[._\-|:·•]+", " ", line)
    line = re.sub(r"\s+", " ", line).strip(" -_.:·•!?")
    if len(line) < 3:
        return ""
    return line[:60].rstrip(" -_.:·•!?")


def group_key(msg_text: str, filename: str, message_id: int) -> str:
    info = extract_episode(filename or "") if filename else {}
    if not info.get("season"):
        info = extract_episode(msg_text or "")
    if info.get("season") and info.get("episode"):
        return f"S{info['season']:02d}E{info['episode']:02d}"
    if info.get("episode"):
        return f"E{info['episode']:03d}"
    if info.get("date"):
        return f"D{info['date']}"
    return f"MID{message_id}"


def _imdb_suggest(q: str, limit=8):
    try:
        qn = urllib.parse.quote(q.strip().lower())
        first = (q.strip().lower() or "x")[0]
        url = f"https://v3.sg.media-imdb.com/suggestion/{first}/{qn}.json"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=8) as r:
            data = json.loads(r.read().decode("utf-8"))
        out = []
        for item in (data.get("d") or [])[:limit]:
            iid = item.get("id") or ""
            if iid.startswith("tt"):
                out.append({"imdb_id": iid, "title": item.get("l") or "",
                            "year": item.get("y"), "kind": item.get("q") or ""})
        return out
    except Exception as e:
        log.error("imdb suggest error: %s", e)
        return []


async def imdb_search(query: str, limit=8):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _imdb_suggest, query, limit)


def _sanitize(name: str) -> str:
    return re.sub(r"[\\/:*?\"<>|]", "_", name).strip()


def release_name(show_title: str, season: int, episode: int, quality: str = "",
                 kind: str = "tv") -> str:
    """A scene-style, parser-friendly release title for Newznab consumers."""
    show = re.sub(r"[^\w\s.\-']", "", show_title or "Unknown").strip() or "Unknown"
    show = re.sub(r"\s+", ".", show)
    q = (quality or "1080p").upper().replace("2160P", "2160p").replace("1080P", "1080p") \
        .replace("720P", "720p").replace("480P", "480p").replace("4K", "2160p").replace("UHD", "2160p")
    q = q if q in ("2160p", "1080p", "720p", "480p") else "1080p"
    if season and episode:
        tag = f"S{int(season):02d}E{int(episode):02d}"
    elif episode:
        tag = f"S01E{int(episode):02d}"
    else:
        tag = ""
    parts = [show] + ([tag] if tag else []) + [q, "WEB-DL", "x264-TELEARR"]
    return ".".join(p for p in parts if p)


def build_save_path(base_dir: str, show_title: str, season: int, episode: int,
                    filename: str, episode_title: str = "") -> str:
    safe_show = _sanitize(show_title) or "Unknown"
    # SECURITY: basename + sanitize the channel-supplied filename so it can never
    # escape base_dir (e.g. "../../data/telearr.db"). Only the basename is ever used.
    safe_fn = _sanitize(os.path.basename(filename or "")).lstrip(".") or "file"
    safe_ep = _sanitize(episode_title or "").strip(" -_.")
    safe_ep = re.sub(r"\s*\.?(mp4|mkv|avi|mov|webm|m4v|flv|wmv|ts|3gp)\s*$", "",
                     safe_ep, flags=re.I).strip(" -_.")
    ext = os.path.splitext(safe_fn)[1].lower() or ".mp4"
    if season and episode:
        folder = f"{base_dir}/{safe_show}/Season {int(season):02d}"
        base = f"{safe_show} - S{int(season):02d}E{int(episode):02d}"
    elif episode:
        folder = f"{base_dir}/{safe_show}/Season 01"
        base = f"{safe_show} - S01E{int(episode):02d}"
    else:
        return f"{base_dir}/{safe_show}/{safe_fn}"
    if safe_ep:
        base = f"{base} - {safe_ep}"
    return f"{folder}/{base}{ext}"


def _safe_component(name: str, fallback: str) -> str:
    """One filesystem-safe path component: no separators, no leading dots
    (so never "." / ".." / a hidden file), never empty."""
    last = os.path.basename((name or "").replace("\\", "/"))
    safe = _sanitize(last).lstrip(". ").rstrip(" ")
    return safe or fallback


def flat_save_path(root: str, category: str, release: str, filename: str) -> str:
    """*arr layout: <root>/<category>/<release>/<file>.

    Every component is sanitized and the result is checked to stay inside
    ``root``, so channel-supplied release or file names can never escape it."""
    path = os.path.join(root, _safe_component(category, "other"),
                        _safe_component(release, "Unknown"), _safe_component(filename, "file"))
    real_root = os.path.realpath(root)
    if os.path.commonpath([real_root, os.path.realpath(path)]) != real_root:
        raise ValueError(f"release path escapes {root!r}")
    return path
