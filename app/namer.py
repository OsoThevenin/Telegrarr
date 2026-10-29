# app/namer.py — filename/caption parsing, IMDb lookup, path building.
# v2 changes vs v1:
#   * season/episode regexes accept _ . - as separators (underscore filenames)
#   * quality detection drives 1080p-vs-4K library routing
#   * episode-title cleanup strips trailing codec/junk tokens
import re
import os
import json
import datetime
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
# Opt-in last resort for series file names: a standalone 1-3 digit number between
# separators ("Harlock 01 - Title", "Harlock.01.720p"). Not part of a decimal (5.1,
# 1.5 GB), a day-first date (12-03-2021) or followed by a unit (700 MB, 10 bit).
BARE_NUMBER_RE = re.compile(
    r"(?<![^\s.\-])(?<!\d[.\-])(\d{1,3})(?![^\s.\-])(?!\.\d(?!\d))(?![.\-]\d{1,2}[.\-]\d{2,4})"
    r"(?!\s*(?:mb|gb|kb|kbps|fps|bit)\b)", re.I)
# a number right after one of these words is a codec, disc or part, not an episode
_NOT_EPISODE_WORDS = {"h", "x", "part", "vol", "disc", "disk", "cd", "dvd", "top"}
_LAST_WORD_RE = re.compile(r"(\w+)[\s.\-]*$")
_SEASON_EPISODE_RES = (SEASON_EPISODE_WORD_RE, TEMPORADA_RE, SEASON_EP_RE, T_C_RE, ALT_SE_RE)
DATE_RE = re.compile(r"(20\d{2})[.\-_ ](\d{1,2})[.\-_ ](\d{1,2})")
# underscore/dot are word chars, so \b fails around them — use explicit boundaries
QUALITY_RE = re.compile(r"(?<![a-z0-9])(2160p|1440p|1080p|720p|480p|4k|uhd)(?![a-z0-9])", re.I)

# Quality tiers: the one source of truth for a channel's fallback choices, the
# DB default, release-name tokens and UHD detection.
QUALITY_SD, QUALITY_720, QUALITY_1080, QUALITY_2160 = "SDTV", "720p", "1080p", "2160p"
CHANNEL_QUALITIES = (QUALITY_SD, QUALITY_720, QUALITY_1080, QUALITY_2160)
DEFAULT_FALLBACK_QUALITY = QUALITY_1080
_UHD = {QUALITY_2160.lower(), "4k", "uhd"}
_SD_RELEASE_TOKEN = "480p"
# any quality spelling -> the token a release name carries
_RELEASE_QUALITY = {**{alias: QUALITY_2160 for alias in _UHD}, QUALITY_1080: QUALITY_1080,
                    QUALITY_720: QUALITY_720, _SD_RELEASE_TOKEN: _SD_RELEASE_TOKEN,
                    QUALITY_SD.lower(): _SD_RELEASE_TOKEN}


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


def _bare_number(text: str) -> re.Match | None:
    for m in BARE_NUMBER_RE.finditer(text):
        word = _LAST_WORD_RE.search(text[:m.start()])
        if not (word and word.group(1).lower() in _NOT_EPISODE_WORDS):
            return m
    return None


def find_episode_marker(text: str, bare: bool = False) -> EpisodeMarker | None:
    """First episode marker in already-normalised text, with its span.

    ``bare`` adds the bare-number fallback, after every explicit marker."""
    for rx in _SEASON_EPISODE_RES:
        m = rx.search(text)
        if m:
            episode = int(m.group(2))
            raw_end = m.group(3) if rx is ALT_SE_RE else None
            return EpisodeMarker(int(m.group(1)), episode, _range_end(episode, raw_end), m.start(), m.end())
    m = EP_ONLY_RE.search(text) or (_bare_number(text) if bare else None)
    if m:
        return EpisodeMarker(None, int(m.group(1)), None, m.start(), m.end())
    return None


def extract_episode(text: str, bare: bool = False) -> dict:
    """Best-effort {season, episode, episode_end, date, quality}."""
    out = {"season": None, "episode": None, "episode_end": None, "date": None, "quality": None}
    if not text:
        return out
    text = _normalise(text)
    marker = find_episode_marker(text, bare)
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
_PART_RE = re.compile(r"\(\s*(\d+)\s*[aª]?\s*part\s*\)", re.I)


def part_number(text: str) -> int | None:
    """N of a "(Na Part)" marker in a caption, file name or episode title."""
    m = _PART_RE.search(_normalise(text or ""))
    return int(m.group(1)) if m else None


def strip_part(text: str) -> str:
    """``text`` without its "(Na Part)" marker."""
    return re.sub(r"\s+", " ", _PART_RE.sub(" ", text or "")).strip()
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


def _title_line(src: str, bare: bool) -> str:
    """The caption line carrying the episode marker, else the first meaningful line."""
    lines = [ln.strip() for ln in src.split("\n") if ln.strip()]
    with_marker = next((ln for ln in lines if find_episode_marker(ln, bare)), "")
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
                          show_title: str = "", mapped: bool = False, bare: bool = False) -> str:
    """Episode title = text after the episode marker.

    Text before the marker (usually the channel's own show name) is ignored on
    mapped channels; unmapped channels fall back to it when nothing follows.
    ``bare`` allows a bare-number marker, only when the title comes from the file name."""
    caption = (msg_text or "").strip()
    src = caption or (filename or "")
    if not src:
        return ""
    bare = bare and not caption
    line = _title_line(_normalise(_EXTENSION_RE.sub("", src)), bare)
    marker = find_episode_marker(line, bare)
    if not marker:
        return _clean_title_text(line, show_title)
    after = _clean_title_text(line[marker.end:], show_title)
    if after or mapped:
        return after
    return _clean_title_text(line[:marker.start], show_title)


def message_episode(msg_text: str, filename: str, bare: bool = False) -> dict:
    """``extract_episode`` of a message, best marker first: season+episode (file
    name, then caption), episode alone (same order), then with ``bare`` the file
    name's bare number. Otherwise whatever the caption has (e.g. a date)."""
    from_file, from_caption = extract_episode(filename or ""), extract_episode(msg_text or "")
    for field in ("season", "episode"):
        found = next((info for info in (from_file, from_caption) if info[field]), None)
        if found:
            return found
    from_bare = extract_episode(filename or "", bare=True) if bare else {}
    return from_bare if from_bare.get("episode") else from_caption


def group_key(msg_text: str, filename: str, message_id: int) -> str:
    info = message_episode(msg_text, filename)
    if info.get("season") and info.get("episode"):
        key = f"S{info['season']:02d}E{info['episode']:02d}"
        key = f"{key}E{info['episode_end']:02d}" if info.get("episode_end") else key
        part = part_number(filename) or part_number(msg_text)   # parts of one episode are distinct files
        return f"{key}P{part}" if part else key
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


# Minimum (width, height) for each quality; a video qualifies on either axis so
# scope-cropped (1920x800) or pillar-boxed (1440x1080) encodes keep their tier.
_QUALITY_FLOORS = (
    (QUALITY_2160, 3200, 2000),
    (QUALITY_1080, 1800, 1000),
    (QUALITY_720, 1200, 700),
)


def quality_from_dims(width: int | None, height: int | None, fallback: str | None = None) -> str | None:
    """Quality tier from the width/height Telegram attaches to a video; fallback when absent."""
    if not width or not height:
        return fallback
    for quality, min_w, min_h in _QUALITY_FLOORS:
        if width >= min_w or height >= min_h:
            return quality
    return QUALITY_SD


LANGUAGE_TOKENS = {"cat": "CAT", "es": "SPA", "en": "ENG", "multi": "MULTI"}
DEFAULT_LANGUAGE = "cat"
RELEASE_SOURCE = "WEB-DL"
RELEASE_CODEC = "x264"
RELEASE_GROUP = "TELEGRARR"
LEGACY_RELEASE_GROUP = "TELEARR"    # upstream's group, still in titles indexed before the rename


def _episode_tag(season: int, episode: int, episode_end: int | None) -> str:
    if not episode:
        return ""
    tag = f"S{int(season or 1):02d}E{int(episode):02d}"
    return f"{tag}E{int(episode_end):02d}" if episode_end else tag


def _release_show(show_title: str) -> str:
    """The series part of a release title: "Old Show (1979)" -> "Old.Show.1979"."""
    show = re.sub(r"[^\w\s.\-']", "", show_title or "Unknown").strip() or "Unknown"
    return re.sub(r"\s+", ".", show)


# What follows the series part of a TV release title: the episode tag (multi-episode
# too) and everything after it, or, without one, [language.]quality.source.codec-group,
# built from the tokens `release_name` writes. Titles from before the language token
# (x264-TELEARR) match as well.
_LANGUAGE = "|".join(map(re.escape, LANGUAGE_TOKENS.values()))
_GROUP = f"{re.escape(RELEASE_GROUP)}|{re.escape(LEGACY_RELEASE_GROUP)}"
_SOURCE_CODEC_GROUP = rf"{re.escape(RELEASE_SOURCE)}\.{re.escape(RELEASE_CODEC)}-(?:{_GROUP})"
_TV_RELEASE_TAIL = re.compile(
    r"\.(?:S\d{2,}E\d{2,}(?:E\d{2,})*\..*"
    rf"|(?:(?:{_LANGUAGE})\.)?[^.]+\.{_SOURCE_CODEC_GROUP})$")


def with_series_title(release_title: str, show_title: str) -> str:
    """A TV release title renamed to ``show_title``, keeping its episode tag, language
    and quality tokens:
    "Show.2002.S01E01E02.CAT.1080p…" -> "Old.Show.1979.S01E01E02.CAT.1080p…".
    Unchanged when the title has no recognizable episode or quality part."""
    tail = _TV_RELEASE_TAIL.search(release_title or "")
    return _release_show(show_title) + tail.group(0) if tail else release_title


def release_name(show_title: str, season: int, episode: int, quality: str = "",
                 kind: str = "tv", language: str = DEFAULT_LANGUAGE,
                 episode_end: int | None = None, year: int | None = None) -> str:
    """A scene-style, parser-friendly release title for Newznab consumers:
    Show.S03E13.CAT.1080p.WEB-DL.x264-TELEGRARR, movies Title.2019.CAT.1080p.WEB-DL.x264-TELEGRARR
    (``year`` is for movies only)."""
    show = _release_show(show_title)
    q = _RELEASE_QUALITY.get((quality or "").lower(), DEFAULT_FALLBACK_QUALITY)
    lang = LANGUAGE_TOKENS.get(language, LANGUAGE_TOKENS[DEFAULT_LANGUAGE])
    if kind == "movie":
        # Movies: the year is the only episode-less tag (Title.2019.CAT...).
        parts = [show, str(year or ""), lang, q, RELEASE_SOURCE, f"{RELEASE_CODEC}-{RELEASE_GROUP}"]
    else:
        # TV: no year of its own; a series title that carries one ("Old Show (1979)",
        # as Sonarr names it) keeps it, so Sonarr matches the release by name.
        parts = [show, _episode_tag(season, episode, episode_end),
                 lang, q, RELEASE_SOURCE, f"{RELEASE_CODEC}-{RELEASE_GROUP}"]
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


# ── movies ────────────────────────────────────────────────────────────
class MovieInfo(NamedTuple):
    title: str
    year: int | None
    quality: str | None


_YEAR_RE = re.compile(r"(?<!\d)(19\d{2}|20\d{2})(?!\d)")
_FIRST_FILM_YEAR = 1888
_LATEST_YEAR_AHEAD = 1                    # films announced for next year
_MOVIE_TAG_RE = re.compile(r"(?<![^\W_])(cat|spa|eng|multi|vose|vo|dual|castell[aà]|catal[aà])(?![^\W_])", re.I)


def _plausible_year(year: int) -> bool:
    return _FIRST_FILM_YEAR <= year <= datetime.date.today().year + _LATEST_YEAR_AHEAD


def _movie_year(text: str) -> re.Match | None:
    """The last plausible release year that is not the start of the text (a title like "2001")."""
    hits = [m for m in _YEAR_RE.finditer(text) if m.start() > 0 and _plausible_year(int(m.group(1)))]
    return hits[-1] if hits else None


def _clean_movie_title(text: str) -> str:
    t = _BRACKETED_RE.sub(" ", text)
    for pat in _JUNK:
        t = re.sub(pat, " ", t, flags=re.I)
    t = _MOVIE_TAG_RE.sub(" ", t)
    t = re.sub(r"[._]+", " ", t)
    t = re.sub(r"[^\w\s'·&!\-]", " ", t)
    return re.sub(r"\s+", " ", t).strip(" -'")


def extract_movie(text: str) -> MovieInfo:
    """A film's {title, year, quality} from a caption line or a file name.

    Title is everything before the release year; without a year the whole
    (cleaned) text is the title and ``year`` is None."""
    src = _normalise(_EXTENSION_RE.sub("", (text or "").strip()))
    lines = [ln.strip() for ln in src.split("\n") if ln.strip()]
    line = next((ln for ln in lines if _movie_year(ln)), lines[0] if lines else "")
    q = QUALITY_RE.search(line)
    quality = q.group(1).lower() if q else None
    year = _movie_year(line)
    if not year:
        return MovieInfo(_clean_movie_title(line), None, quality)
    return MovieInfo(_clean_movie_title(line[:year.start()]), int(year.group(1)), quality)
