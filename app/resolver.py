# app/resolver.py — two-part episode resolution.
#
# Channels often post one long episode as "3x13 Títol (1a Part)" and
# "3x13 Títol (2a Part)", while TVDB (what Sonarr matches against) lists the
# parts as episodes 13 and 14. For a "(Na Part)" title the resolver looks the
# season up in TMDB (Catalan, then English) and then Sonarr, matches episode
# names accent-insensitively and fuzzily, and when consecutive episodes share
# the base title maps part N to base + N − 1. Otherwise the channel's
# numbering is kept.
from __future__ import annotations

import logging
import re
import unicodedata
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Awaitable, Callable

from . import connect, tmdb
from .namer import part_number, strip_part

log = logging.getLogger("resolver")

# Minimum SequenceMatcher ratio between normalised titles to call them the same
# episode name (tolerates small spelling/punctuation differences, not new words).
MATCH_THRESHOLD = 0.85
KEPT = "channel"   # source recorded when no metadata matched confidently

# How metadata marks a part at the end of an episode name: "(1)", "Part 2",
# "(Parte 1)", "Pt. 2", "(2a part)", "Part One". A bare unbracketed number is
# left alone ("Apollo 13" is a title, not part 13).
_METADATA_PART_RE = re.compile(
    r"(?:\s*\(\s*\d+\s*\)"
    r"|[\s,:;\-–—]*[\(\[]?\s*(?:part|parte|pt\.?)\s*(?:\d+|one|two|three|i{1,3})\s*[\)\]]?"
    r"|[\s,:;\-–—]*\(\s*\d+\s*[aª]?\s*part\s*\))\s*$", re.I)
_NON_ALNUM_RE = re.compile(r"[^a-z0-9]+")

Listing = list[tuple[int, str]]   # (episode number, episode name)


@dataclass(frozen=True)
class Resolution:
    episode: int     # episode number to publish
    source: str      # "tmdb-ca" | "tmdb-en" | "sonarr" | KEPT


def _fold(text: str) -> str:
    """Lowercase, accent-free, punctuation-free form of an episode name."""
    decomposed = unicodedata.normalize("NFKD", text or "")
    plain = "".join(ch for ch in decomposed if not unicodedata.combining(ch)).lower()
    return _NON_ALNUM_RE.sub(" ", plain).strip()


def _base_name(metadata_name: str) -> str:
    """A metadata episode name without its trailing part marker, folded."""
    return _fold(_METADATA_PART_RE.sub("", metadata_name or ""))


def _similar(a: str, b: str) -> bool:
    return bool(a and b) and SequenceMatcher(None, a, b).ratio() >= MATCH_THRESHOLD


def _runs(numbers: list[int]) -> list[list[int]]:
    """Consecutive runs of sorted episode numbers: [12, 13, 15] -> [[12, 13], [15]]."""
    runs: list[list[int]] = []
    for n in numbers:
        if runs and n == runs[-1][-1] + 1:
            runs[-1] = [*runs[-1], n]
        else:
            runs.append([n])
    return runs


def match_part(listing: Listing, base_title: str, part: int, episode: int) -> int | None:
    """Episode number for part ``part`` of ``base_title`` given a season listing.

    None when no episode name matches confidently. A run of consecutive matches
    (the parts listed separately) maps part N to its first episode + N − 1; a
    single match keeps the channel's ``episode``."""
    wanted = _fold(base_title)
    matches = sorted(n for n, name in listing if _similar(_base_name(name), wanted))
    if not matches:
        return None
    run = min(_runs(matches), key=lambda r: (episode not in r, abs(r[0] - episode)))
    if len(run) >= 2 and part <= len(run):
        return run[0] + part - 1
    return episode


def _sources(tmdb_id: int | None, tvdb_id: int | None) -> list[tuple[str, Callable[[int], Awaitable[Listing]]]]:
    sources = []
    if tmdb_id:
        for name, language in (("tmdb-ca", "ca-ES"), ("tmdb-en", "en-US")):
            sources.append((name, lambda season, lang=language: tmdb.season_episodes(tmdb_id, season, lang)))
    if tvdb_id:
        async def sonarr(season: int) -> Listing:
            return [(e.episode, e.title) for e in await connect.sonarr_episodes(tvdb_id, season)]
        sources.append(("sonarr", sonarr))
    return sources


async def resolve_part(*, tmdb_id: int | None, tvdb_id: int | None, season: int | None,
                       episode: int | None, episode_title: str) -> Resolution | None:
    """Resolve a "(Na Part)" episode; None when the title carries no part marker.

    Sources are tried in order TMDB ca → TMDB en → Sonarr; one that fails or
    has no confident match falls through to the next. With no match anywhere
    the channel's numbering is kept (source ``KEPT``)."""
    part = part_number(episode_title)
    if not part or not season or not episode:
        return None
    base_title = strip_part(episode_title)
    for name, fetch in _sources(tmdb_id, tvdb_id):
        try:
            listing = await fetch(season)
        except (tmdb.TMDBError, connect.ArrError) as e:
            log.info("part resolution: %s unavailable for S%02d: %s", name, season, e)
            continue
        resolved = match_part(listing, base_title, part, episode)
        if resolved is not None:
            return Resolution(resolved, name)
    return Resolution(episode, KEPT)
