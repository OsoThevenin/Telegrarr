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
from typing import NamedTuple

log = logging.getLogger("namer")

_SEP = r"[\s._\-]*"
# Episode markers, in priority order. Text is NFKC-normalised and underscores
# become spaces before matching (see _normalise).
SEASON_EPISODE_WORD_RE = re.compile(
    rf"Season{_SEP}(\d{{1,2}}){_SEP}Episode{_SEP}(\d{{1,3}})", re.I)
TEMPORADA_RE = re.compile(
    rf"\bTemporada{_SEP}(\d{{1,2}})[\s.,\-]*(?:Cap[ií]tol|Cap|Episodi|Ep|C)[\s.\-]*(\d{{1,3}})(?!\d)", re.I)
SEASON_EP_RE = re.compile(rf"(?<![a-z0-9])S{_SEP}(\d{{1,2}}){_SEP}E{_SEP}(\d{{1,3}})", re.I)
T_C_RE = re.compile(r"(?<![a-z0-9])T(\d{1,2})[CE](\d{1,3})(?![a-z0-9])", re.I)
# NxNN with an optional double-episode range: 1x01-02, 1x01-1x02
ALT_SE_RE = re.compile(r"(?<!\d)(\d{1,2})x(\d{1,3})(?:-(?:\d{1,2}x)?(\d{1,3}))?(?![\da-z])", re.I)
EP_ONLY_RE = re.compile(
    r"(?<![a-z0-9])(?:(?:Cap[ií]tol|Cap|Episodi|Episode|Ep)[\s.\-]*|C)(\d{1,3})(?!\d)", re.I)
_SEASON_EPISODE_RES = (SEASON_EPISODE_WORD_RE, TEMPORADA_RE, SEASON_EP_RE, T_C_RE, ALT_SE_RE)
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


class EpisodeMarker(NamedTuple):
    season: int | None
    episode: int
    episode_end: int | None
    start: int
    end: int


def _normalise(text: str) -> str:
    """Compose accents (NFD filenames from macOS) and turn underscores into spaces."""
    return unicodedata.normalize("NFKC", text or "").replace("_", " ")


def _range_end(episode: int, raw_end: str | None) -> int | None:
    end = int(raw_end) if raw_end else None
    return end if end and end > episode else None


def find_episode_marker(text: str) -> EpisodeMarker | None:
    """First episode marker in already-normalised text, with its span."""
    for rx in _SEASON_EPISODE_RES:
        m = rx.search(text)
        if m:
            episode = int(m.group(2))
            raw_end = m.group(3) if rx is ALT_SE_RE else None
            return EpisodeMarker(int(m.group(1)), episode, _range_end(episode, raw_end), m.start(), m.end())
    m = EP_ONLY_RE.search(text)
    if m:
        return EpisodeMarker(None, int(m.group(1)), None, m.start(), m.end())
    return None


def extract_episode(text: str) -> dict:
    """Best-effort {season, episode, episode_end, date, quality}."""
    out = {"season": None, "episode": None, "episode_end": None, "date": None, "quality": None}
    if not text:
        return out
    text = _normalise(text)
    marker = find_episode_marker(text)
    if marker:
        out["season"], out["episode"], out["episode_end"] = marker.season, marker.episode, marker.episode_end
    d = DATE_RE.search(text)
    if d:
        out["date"] = f"{d.group(1)}-{int(d.group(2)):02d}-{int(d.group(3)):02d}"
    q = QUALITY_RE.search(text)
    if q:
        out["quality"] = q.group(1).lower()
    return out


_EXTENSION_RE = re.compile(r"\.(mp4|mkv|avi|mov|webm|m4v|flv|wmv|ts|3gp)\s*$", re.I | re.M)
# A "(1a Part)" / "(2a Part)" suffix is part of the episode title, not noise.
_PART_RE = re.compile(r"\(\s*\d+\s*[aª]?\s*part\s*\)", re.I)
_BRACKETED_RE = re.compile(r"[\[\(\{][^\]\)\}]{0,80}[\]\)\}]")
_LABEL_LINE_RE = re.compile(r"^(title|file|name|size|quality|audio|video|language|season|"
                            r"episode|ep)\s*[:：\-]?\s*$", re.I)
_TITLE_SEPARATORS_RE = re.compile(r"[._\-|:·•]+")
_MIN_TITLE_LEN = 3
_MAX_TITLE_LEN = 60
# "avi" is deliberately not listed: it is a Catalan word (grandfather); file
# extensions are stripped by _EXTENSION_RE instead.
_JUNK = [
    r"\b(mp4|mkv|mov|webm|m4v|flv|wmv|ts|3gp)\b",
    r"\b(2160p|1440p|1080p|720p|480p|360p|4k|uhd|hd|sd)\b",
    r"\b(x[\s._-]?26[45]|h[\s._-]?26[45]|hevc|avc|aac2?|ac3|dd5?\.?1|mp3|opus)\b",
    r"\b(web[\s-]?dl|web[\s-]?rip|hdrip|hdtv|dvdrip|bluray|brrip|amzn|nf|dsnp|"
    r"hmax|hotstar|jio(cinema)?|voot|mx|sony(liv)?|jstar|jh|netflix|hulu|disney\+?)\b",
    r"\b(hindi|english|tamil|telugu|dual audio|multi audio|subs?)\b",
    r"\b\d+(\.\d+)?\s*(mb|gb|kbps|fps)\b",
]


def _title_line(src: str) -> str:
    """The caption line carrying the episode marker, else the first meaningful line."""
    lines = [ln.strip() for ln in src.split("\n") if ln.strip()]
    with_marker = next((ln for ln in lines if find_episode_marker(ln)), "")
    if with_marker:
        return with_marker
    meaningful = next((ln for ln in lines if not _LABEL_LINE_RE.match(ln)), "")
    return meaningful or src.split("\n")[0]


def _keep_part_suffix(m: re.Match) -> str:
    return m.group(0) if _PART_RE.fullmatch(m.group(0)) else " "


def _clean_title_text(text: str, show_title: str) -> str:
    line = re.sub(r"^[^\w]*\b(title|file|name)\b\s*[:：\-—]?\s*", "", text, flags=re.I)
    line = re.sub(r"https?://\S+", " ", line)
    line = re.sub(r"[@#]\w+", " ", line)
    line = _BRACKETED_RE.sub(_keep_part_suffix, line)
    line = _TITLE_SEPARATORS_RE.sub(" ", line)
    for rx in (*_SEASON_EPISODE_RES, EP_ONLY_RE):
        line = rx.sub(" ", line)
    for pat in _JUNK:
        line = re.sub(pat, " ", line, flags=re.I)
    for st in filter(None, [show_title, re.sub(r"\s+", " ", show_title or "")]):
        line = re.sub(re.escape(st).replace(r"\ ", r"[\s_]+"), " ", line, flags=re.I)
    line = _TITLE_SEPARATORS_RE.sub(" ", line)
    line = re.sub(r"\s+", " ", line).strip(" -_.:·•!?")
    if len(line) < _MIN_TITLE_LEN:
        return ""
    return line[:_MAX_TITLE_LEN].rstrip(" -_.:·•!?")


def extract_episode_title(msg_text: str, filename: str, season: int, episode: int,
                          show_title: str = "", mapped: bool = False) -> str:
    """Episode title = text after the episode marker.

    Text before the marker (usually the channel's own show name) is ignored on
    mapped channels; unmapped channels fall back to it when nothing follows."""
    src = (msg_text or "").strip() or (filename or "")
    if not src:
        return ""
    line = _title_line(_normalise(_EXTENSION_RE.sub("", src)))
    marker = find_episode_marker(line)
    if not marker:
        return _clean_title_text(line, show_title)
    after = _clean_title_text(line[marker.end:], show_title)
    if after or mapped:
        return after
    return _clean_title_text(line[:marker.start], show_title)


def group_key(msg_text: str, filename: str, message_id: int) -> str:
    info = extract_episode(filename or "") if filename else {}
    if not info.get("season"):
        info = extract_episode(msg_text or "")
    if info.get("season") and info.get("episode"):
        key = f"S{info['season']:02d}E{info['episode']:02d}"
        return f"{key}E{info['episode_end']:02d}" if info.get("episode_end") else key
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
