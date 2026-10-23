# Telegrarr v1.0.0 — Specification and milestone plan

Status: agreed 2026-10-22 after design interview. Fork of [Wishaal/Telearr](https://github.com/Wishaal/Telearr) v2.3.3.
Versioning restarts at Telegrarr v1.0.0. Internal identifiers (`telearr` cookie, `TELEARR_*` env vars,
module names) stay unchanged to keep upstream merges clean; only user-facing branding changes.

## 1. Goal

Expose Telegram channels to Sonarr and Radarr as a usenet-style source (Newznab indexer + SABnzbd
download client), tuned for Catalan content, so that a Catalan episode or film posted on Telegram
reaches Jellyfin through the existing *arr import pipeline with no manual steps.

## 2. Target environment (homelab facts)

| Item | Value |
|---|---|
| Sonarr / Radarr | 4.0.19 / 6.3.0, inside gluetun network namespace, on `proxy_net` by alias |
| Prowlarr | present, syncs indexers to both apps |
| Jellyfin | linuxserver image, libraries Pel·lícules / Sèries / Col·leccions |
| Download disk | `${PATH_TO_DOWNLOADS}` mounted at `/downloads` in both *arrs (separate disk from media, imports are copies) |
| Existing shim | amutorrent (aMule as qBittorrent API), registered manually |
| Custom formats | `Català (idioma)` 2000, `Català (titol)` regex `(CAT|CATALAN|CATALÀ|CATUB)[.\-_\s]` 1000, Sonarr HD-1080p minFormatScore 999 |
| VPN proxy | gluetun HTTP proxy `gluetun:8888`, SOCKS `gluetun:1080` |
| Reverse proxy | NPM, `*.gombrenflix.com`, access list 1 (LAN + Tailscale) |
| TMDB key | user already has one |

## 3. Decisions

### 3.1 Operating mode
- *arr mode is the primary, supported path.
- Standalone library mode and Plex refresh remain as upstream features, untouched and unsupported.
- *arr grabs land in flat folders: `/downloads/telegram/<category>/<release name>/<file>`.
  Same path inside Telegrarr, Sonarr and Radarr → no remote path mapping.
- Jellyfin is notified by Sonarr/Radarr "Emby/Jellyfin" connections. No Jellyfin code in Telegrarr.

### 3.2 Channel shapes
- **Series channel**: one channel = one series, mapped to a TVDB id.
- **Movie channel**: one channel with many films. Each message's title and year are parsed and
  looked up on TMDB (language `ca-ES`, fallback `en-US`). No confident match → **Pending review**
  queue in the UI where the user picks the film or discards the message.
- **Directory channel** (last milestone): a channel that posts links to per-show channels.
  Telegrarr scans it, lists linked channels with an auto-suggested TMDB match, and imports the
  ticked ones in one go.
- Out of scope: one channel with many different series.

### 3.3 Identity mapping
- Channel dialog: type (series | movie channel), TMDB search box (Catalan titles), editable id
  field (TVDB id for series; TMDB or IMDb id for movies). Other ids derived via TMDB external ids.
- TMDB key becomes required.
- Newznab caps advertise `tvdbid`, `tmdbid`, `imdbid`; search endpoints honour them.

### 3.4 Catalan parsing (namer.py)
Rules, each backed by a test using real samples:
- Underscores → spaces before parsing.
- Episode markers anywhere in text: `NxNN`, `T3C13`, `T03E13`, `Temporada N` + `Capítol N`,
  `Cap. N`, `Cap N`, `C13`, `Episodi N`, `Ep. N`, plus existing English forms.
- Double episodes: `1x01-02`, `1x01-1x02`.
- Text after the marker = episode title; text before it is ignored on mapped channels.
- `(1a Part)`, `(2a Part)` stay in the title. Resolution: fetch season episodes from TMDB `ca-ES`,
  then TMDB `en-US`, then Sonarr's episode list; if two consecutive episodes share the base title,
  part N → episode base + N − 1; otherwise keep channel numbering. Accent-insensitive fuzzy match.
- Samples: `3x13 Un viatge pel temps (2a Part)`,
  `El_Senyor_dels_Anells_Els_anells_de_poder_1x01_Una_ombra_del_passat.avi`.
- Quality inferred from Telegram video attributes (width × height) → SDTV / HDTV-720p / 1080p /
  2160p; per-channel fallback quality when attributes are missing. Source defaults to WEB-DL.

### 3.5 Release naming
- Per-channel language field (`cat` default, `es`, `en`, `multi`), rendered as `CAT`, `SPA`, `ENG`,
  `MULTI` token in the release title so existing custom formats score it.
- Format: `Show.S03E13.CAT.1080p.WEB-DL.x264-TELEGRARR`, movies `Title.2019.CAT.1080p.WEB-DL.x264-TELEGRARR`.

### 3.6 Account safety (personal Premium account)
- Real device fingerprint (device_model, system_version, app_version mimicking official desktop).
- One persistent session file.
- Defaults: 4 MTProto senders per file, 2 concurrent files.
- Channel polling ≥ 15 min with random jitter.
- Optional daily download budget (GB), default unlimited.
- No automatic channel joining, no mass dialog fetching beyond the dialog picker.
- Global FloodWait gate with exponential back-off; notification when a wait exceeds 10 min.

### 3.7 Integrations
- **Connect page**: enter Prowlarr, Sonarr, Radarr URLs + API keys; one click registers the
  Newznab indexer in Prowlarr and the SABnzbd client in Sonarr and Radarr. Manual path documented.
- Sonarr connection is also used for episode lists (3.4).

### 3.8 UI
- Dictionary-based i18n in the JS SPA (`t()` + `ca`/`en` dictionaries), Catalan default,
  English switchable. Covers all UI strings, error messages, notifications and the Telegram login flow.

### 3.9 Hardening
- Bump FastAPI so starlette ≥ 1.3.1 (PYSEC-2026-248/249/2280/2281/1942).
- `USER` directive in Dockerfile.
- Secure flag on cookie reissued after username change.

### 3.10 Delivery
- Feature branches → PRs into `main`, conventional commits.
- CI builds and pushes `ghcr.io/osothevenin/telegrarr` on tags.
- README in Catalan and English.
- Rollout on OMV: stack at `/appdata/telegrarr` on `proxy_net` + `media_net`, not inside gluetun,
  `TELEARR_PROXY=http://gluetun:8888`; NPM host `telegrarr.gombrenflix.com` with access list 1;
  Prowlarr/Sonarr/Radarr registration; Sonarr and Radarr Jellyfin connections. Each server-side
  step confirmed by the user.

### 3.11 Out of scope for v1.0.0
Bazarr, Lidarr/music, multi-user, standalone library mode and Plex refresh, many-series channels.

## 4. Milestones

| # | Milestone | Deliverable | Done when |
|---|---|---|---|
| M0 | Baseline | Branding, hardening (3.9), CI image name, tests green | `ghcr.io/osothevenin/telegrarr:0.9.0-rc` builds and runs |
| M1 | Catalan parser | namer.py rules + tests (3.4), language token (3.5), quality inference | Both samples parse to expected S/E, title, quality |
| M2 | Id mapping | Channel dialog, TMDB search, id derivation, Newznab id search (3.3) | Sonarr search by tvdbid returns releases |
| M3 | *arr download layout | Flat folder output, SAB queue/history paths (3.1) | Sonarr imports a grab without path mapping |
| M4 | Movie channels | Per-message parsing, TMDB lookup, review queue (3.2) | Radarr grabs a film from a mixed channel |
| M5 | Part resolution | TMDB/Sonarr episode matching for `(Na Part)` (3.4) | Sample resolves correctly in tests |
| M6 | Account safety | Fingerprint, throttles, budget, back-off (3.6) | Settings exposed; FloodWait test passes |
| M7 | Connect page | One-click registration (3.7) | Fresh Prowlarr/Sonarr/Radarr register in one click |
| M8 | Catalan UI | i18n dictionaries, default `ca` (3.8) | No English string visible in `ca` mode |
| M9 | Rollout | Compose, NPM, registrations, Jellyfin connections (3.10) | A Catalan episode appears in Jellyfin end to end |
| M10 | Directory channels | Scan + mass import (3.2) | Import of a linked-channel list works; may slip to v1.1 |

M9 marks v1.0.0 feature-complete; M10 ships in v1.0.0 only if it lands without delaying M9.
