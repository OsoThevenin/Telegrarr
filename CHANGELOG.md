# Changelog

## [Unreleased]

### Added
- Movie channels' drawers show the channel's **Catalog**: one row per film it offers
  (best release by resolution, then size), with quality, size and language, plus
  "Cal identificar" rows linking to Review. Built from stored data only — opening it
  sends nothing to Telegram. New endpoint `GET /api/channels/{id}/catalog`.
- Catalog rows show what Radarr already has: **Sol·licitada** (in Radarr without a
  file), **Baixada**, or **Baixada · 720p** plus **Millora qualitat** when the channel
  offers a higher resolution (resolution only; the Radarr profile is ignored). The
  list shows first and Radarr's state fills in, from one Radarr movie-list request per
  load. A connection dot shows Radarr's state; when it is unconfigured or unreachable a
  "Radarr no connectat" notice links to Connect. New endpoint
  `GET /api/channels/{id}/catalog/status`.
- Connect: choose the Radarr quality profile and root folder Telegrarr uses when it
  adds a film, picked from Radarr's own lists. Until you pick, Radarr's first profile
  and first root folder are used.
- Catalog rows show the film's poster: Radarr's when Radarr has the film, otherwise
  TMDB's (cached, so reopening a Catalog asks TMDB nothing new); a coloured tile with
  the short title when there is none. Posters load after the list, from
  `GET /api/channels/{id}/catalog/posters`.
- **Baixar** on Catalog rows asks Radarr for the film: a film Radarr lacks is added
  (monitored, the Connect profile and root folder, searching on add); for an
  upgradeable film (**Baixar 1080p**) Radarr only searches again, its settings
  untouched. The row turns **Sol·licitada** at once and stays so after a reload.
  Pressing twice never adds a duplicate. When Radarr refuses, nothing is saved and a
  toast gives Radarr's reason with **Torna-ho a provar**. New endpoint
  `POST /api/channels/{id}/catalog/{tmdb_id}/download`.

## 1.0.2 — Retry, cancel, and series-year matching (2026-10-28)

### Fixed
- Series releases now carry the show's premiere year before the episode tag
  (`Anne.of.Green.Gables.1979.S01E07…`), so Sonarr matches a series whose title
  includes the year (`Anne of Green Gables (1979)`) by name instead of only by id —
  id-matched grabs can't auto-import. Newly mapped channels store the year
  automatically; re-map an existing channel to backfill it.
- Retry (single or bulk) re-queues only failed or cancelled downloads; a queued or
  downloading row is left alone instead of being reset to 0% and losing its Cancel.
  The UI says "Re-queued" only when something was, and bulk Retry reports how many.
- Cancel always stops the task really downloading a row, and the UI says when there
  was nothing to cancel. Bulk Cancel reports how many it stopped.
  A row waiting while downloads are paused can be cancelled too, and stays cancelled
  on Resume.
- A Retry right after a Cancel no longer leaves a row stuck in Queued, and the
  stopping download can't overwrite the new attempt's status.
  If the old transfer hasn't stopped within a minute, the new attempt fails with
  "The previous attempt didn't stop in time; retry later" instead of waiting forever.
- A failed Retry says why (e.g. the Telegram message is gone), and Telegrarr no longer
  asks Telegram before checking the row can be retried.
- A second message for an episode that is already downloading is marked cancelled
  ("Already downloading from another message") instead of staying Queued forever.
- Every re-queue of a failed or cancelled download (Retry, auto-retry, or a Sonarr/
  Radarr re-grab) gets a new download id (`telearr<id>-<attempt>`), so the \*arr
  shows and imports it without a restart. Ids handed out earlier keep working.
- Removing a finished item from history in Sonarr/Radarr hides it from the history
  Telegrarr reports, so the \*arr stops re-sending the delete. The download row and
  its files are kept.

## 1.0.1 — Bare-number episodes (2026-10-27)

### Fixed
- Series files that name the episode only with a bare number after the show name
  (`El Capità Harlock 01 - La bandera pirata de l'espai.mkv`) are published as
  numbered releases (`S01E01`), so Sonarr can match and grab them. The bare number
  is the last fallback and never matches years, `720p`, `x264` or numbers inside
  words. Re-index (backfill) a channel to re-title releases it already indexed.
- An episode-only series release uses season 1, not season 0 (Sonarr's specials).
- An episode found in the file name is kept when the caption has no marker; the
  caption wins only with a better marker (season + episode, or an explicit episode
  marker over a bare number). Bare numbers in captions are never episodes.
- Newznab `tvsearch` with `season=` or `ep=` returns only matching releases and
  leaves out releases without a season or episode. Searches without them still
  list everything.

## 1.0.0 — Telegrarr: Catalan content for the \*arr stack (2026-10-27)

First Telegrarr release. Telegrarr is a fork of
[Wishaal/Telearr](https://github.com/Wishaal/Telearr) v2.3.3 and restarts
versioning at 1.0.0. Changes against upstream v2.3.3:

### Branding and delivery
- User-facing name is **Telegrarr** (web UI, notifications, Newznab caps/feed,
  update check against `OsoThevenin/Telegrarr`). Internal identifiers stay as
  upstream: `TELEARR_*` env vars, the `telearr_sess` cookie, `telearr.db`, module
  names and the `telearr` NZB/nzo prefixes.
- CI publishes a multi-arch (amd64/arm64) image to the public
  `ghcr.io/osothevenin/telegrarr`: `1.0.0`, `1.0` and `latest` on version tags
  after the tests pass, and `main` on manual runs. CI also runs `pip-audit`.
- Compose works out of the box: `.env.example` ships no placeholder host paths
  (media and downloads default to `./media` and `./downloads`), and
  `TELEARR_MEDIA_ROOT` is only needed for standalone mode.
- `authorize.py` ships in the image, uses the service's device fingerprint, and
  exits with a clear message when the Telegram API credentials are missing.
- README in Catalan (`README.ca.md`) and English (`README.md`).

### \*arr mode (the supported path)
- New `operating_mode` setting: `arr` (default) indexes channels for
  Sonarr/Radarr and downloads only what they grab; `standalone` keeps the upstream
  auto-download into the library (unsupported).
- Flat download layout `/downloads/telegram/<tv|movies>/<release name>/<file>`
  (base from `TELEARR_DOWNLOADS_DIR` or Settings, host path `PATH_TO_DOWNLOADS`), so
  Telegrarr, Sonarr and Radarr see the same path and no remote path mapping is
  needed. SABnzbd queue/history report the release folder; categories `tv`/`movies`.
- **Connect page**: save Prowlarr, Sonarr and Radarr URLs and API keys, test them,
  and register Telegrarr as a Newznab indexer (Prowlarr) and SABnzbd download
  client (Sonarr, Radarr) in one click. Idempotent by name. Manual path in
  `docs/CONNECT.md`.

### Identity mapping
- Series channels map to a TVDB id through a TMDB search (Catalan titles first,
  English fallback) or an editable TVDB id; TMDB and IMDb ids are derived. A TMDB
  API key is now required for mapping.
- Newznab caps advertise `tvdbid`, `tmdbid` and `imdbid`; search honours them and
  feed items carry the id attributes.
- **Movie channels**: each message's title and year are matched on TMDB (`ca-ES`,
  then `en-US`). Unconfident matches go to a new **Review** queue where you pick
  the film or discard the message.
- **Directory channels**: scan a channel that posts `t.me` links and import the
  linked series channels in one go, with a suggested TMDB match per channel.

### Catalan parsing and release naming
- Episode markers anywhere in the text: `NxNN`, `T3C13`, `T03E13`,
  `Temporada N` + `Capítol N`, `Cap. N`, `Cap N`, `C13`, `Episodi N`, `Ep. N`, plus
  the English forms; double episodes `1x01-02` and `1x01-1x02`; underscores are
  read as spaces.
- The episode title is the text after the marker; `(1a Part)`/`(2a Part)` is kept
  and resolved to the real episode number from TMDB `ca-ES`, then `en-US`, then
  Sonarr's episode list (accent-insensitive fuzzy match).
- Quality comes from the Telegram video dimensions (SDTV / 720p / 1080p / 2160p),
  with a per-channel fallback quality.
- Per-channel audio language (`cat` default, `es`, `en`, `multi`) is written as a
  `CAT`/`SPA`/`ENG`/`MULTI` token, and the release group is `TELEGRARR`:
  `Show.S03E13.CAT.1080p.WEB-DL.x264-TELEGRARR`,
  `Title.2019.CAT.1080p.WEB-DL.x264-TELEGRARR`.

### Account safety
- Desktop client fingerprint (`TELEARR_TG_DEVICE_MODEL`,
  `TELEARR_TG_SYSTEM_VERSION`, `TELEARR_TG_APP_VERSION`).
- Defaults: 4 senders per file, 2 concurrent files.
- Channel polling has a 15-minute floor (lower values are rejected) plus random
  jitter.
- Optional daily download budget in GB (0 = unlimited) that pauses downloads until
  the next day.
- Global FloodWait gate with exponential back-off and a notification when a single
  wait exceeds 10 minutes.
- Telegrarr no longer joins channels automatically.

### Interface
- Catalan UI by default with an English switch (Settings → Account →
  Appearance). UI strings, API errors, notifications, the Activity log and
  download failure reasons are translated.
- Disk-usage widgets measure the downloads folder in \*arr mode.

### Hardening
- FastAPI bumped so Starlette ≥ 1.3.1 (PYSEC advisories).
- The image runs as non-root UID/GID 1000 by itself (`USER` in the Dockerfile).
- The session cookie reissued after a username change keeps the `Secure` flag.
- API errors no longer echo raw exception text (TMDB, directory import); the
  detail goes to the server log. New endpoints validate their request bodies and
  answer a translated 400 on bad input.

## 2.3.3 — Proxy / VPN support (2026-09-26)
- **Route Telegram through a proxy/VPN** to get past ISP throttling or blocking of
  Telegram data centers (the cause of downloads that stall on one DC while the
  main connection is fine). Configure from Settings → Integrations → Proxy / VPN
  or the `TELEARR_PROXY` env var. Supports `socks5://`, `socks4://`, `http://`
  (via python-socks) and Telegram's own `mtproxy://<secret>@host:port`.
- Saving a proxy reconnects the client through it and reports success/failure; a
  bad or unreachable proxy safely degrades to a direct connection. Credentials
  are never shown back in the UI. Only Telegram traffic is proxied.

## 2.3.2 — Download hang & app-freeze fixes (2026-09-26)
- **Scan no longer freezes the whole app.** File preallocation (and the file
  open) ran synchronously on the single event loop; on a slow/FUSE mount
  (ntfs-3g) zero-filling a multi-GB file blocked every request — including
  `/healthz` — for seconds whenever a scan queued a large download. Preallocation
  now runs in a thread executor.
- **Downloads can no longer stall forever.** Each 1 MB part fetch is bounded by a
  timeout (`PART_TIMEOUT`), and the sender-export ("borrow") to a remote DC is
  bounded too — a hung/desynced sender (seen with DC5) now aborts and falls back
  to the sequential downloader instead of freezing at 0% holding the queue slot.
- **Auto-retry for failed downloads** — a channel's failed grabs are re-queued on
  each scan up to 3 times, so a transient drive/network blip recovers on its own;
  a file already fully on disk is finalized instead of re-downloaded.
- **Non-premium FloodWait handled** — the fast downloader now catches
  `FloodPremiumWaitError` so it stays on the ~10 MB/s fast path instead of
  dropping to the slow sequential fallback.

## 2.3.1 — Download reliability (2026-08-16)
- **Fast downloads no longer crawl or stall.** The parallel downloader caught
  `FloodWaitError` but not Telethon's separate `FloodPremiumWaitError` (the
  "a wait of N seconds is required in non-premium accounts" throttle, which is
  not a subclass). On non-premium accounts that error escaped, killed the fast
  path near the end, and dropped every download to the ~1.4 MB/s sequential
  fallback — which, if interrupted, never finished. The worker now absorbs both
  flood errors (brief pause + retry), so downloads complete on the fast path
  (~10 MB/s).
- **Crash-recovery for finished files.** If a file is already fully on disk
  (e.g. completed but not finalized before a restart, or grabbed by a sibling
  source), `_run_download` finalizes it instead of re-downloading — no more
  rows stuck at "downloading" holding the queue slot.

## 2.3.0 — Multi-source shows, PWA & mobile polish (2026-08-16)

### Multi-source shows
- **Per-show download de-duplication** — several source channels can feed one
  title (shared IMDb mapping). When one channel goes stale and another posts the
  new episode, Telearr no longer re-downloads episodes a sibling source already
  has (dedup spans every channel sharing the mapping).
- **Channels grouped by show** — source channels for one title collapse into a
  single poster card ("N sources"); the detail drawer lists each source with
  per-source enable/edit/remove and Scan/Backfill acting on all sources at once.
- **Downloads grouped by show** — completed items group by library folder, not
  by channel, so a multi-source show is one group.

### PWA & UX polish
- **Dashboard redesign** — the six big equal-weight tiles become a compact stat
  strip, and the page is no longer hollow when idle: new **Up next** (soonest
  scheduled channel scans) and **Recently grabbed** (last downloads) panels.
  Stat tiles are now clickable (Channels/Completed/Failed jump to that view,
  keyboard-accessible).
- **Installable PWA on Android & iOS** — real PNG app icons (192/512 + a 512
  maskable), an `apple-touch-icon`, and a **service worker** (`/sw.js`, root
  scope) that precaches the app shell for offline and serves static assets
  cache-first. Registration is guarded to secure contexts. *(Install/offline
  require HTTPS or localhost; see the README note.)*
- UX: poster-card actions now reveal on hover (visible on touch) instead of
  cluttering every card; the storage donut turns amber past 85% and red only
  past 95% (alarm colour reserved for alarms); the mobile bottom nav is capped
  at five items (Activity stays in the sidebar and ⌘K).

### Security
- **Login throttling** — eight failed attempts from one client inside five
  minutes locks that client out for fifteen. Successful logins reset the
  counter; existing sessions are unaffected. Failures and lockouts are logged.
- **No username enumeration** — an unknown username now costs the same bcrypt
  work as a wrong password, so the two cannot be told apart by timing.
- **`Secure` session cookie** when the request arrives over TLS (directly or
  via `X-Forwarded-Proto`), while plain-HTTP LAN deployments keep working.
- **Security headers** on every response: a strict `Content-Security-Policy`,
  `X-Frame-Options: DENY`, `X-Content-Type-Options`, `Referrer-Policy`,
  `Cross-Origin-Opener-Policy`, and `Permissions-Policy`.
- **Minimum password length raised** from 6 to 12 characters.
- Malformed `chat_id` values return `400` instead of a `500`.
- The admin username defaults to `admin`, and the media root and bind address
  are configured via `TELEARR_MEDIA_ROOT` / `TELEARR_BIND_ADDR` rather than
  being hardcoded to one machine's layout.

### Mobile
- Fixed the System health rows (status badge no longer orphaned onto its own
  line), the dashboard "Active now" idle state (no longer blanked by live
  updates), and list overflow in "Up next" / "Recently grabbed".
- Compact stat tiles and a clearer, more opaque fixed bottom nav; poster-card
  actions move into the detail drawer on touch instead of stacking.

### Account & branding
- **Change username** from Settings → Account (re-issues the session cookie so
  you stay signed in); Settings reorganised into tabs (Account / Downloads /
  Integrations).
- **Structured Activity log** — severity badges, relative times, search, and
  collapse of repeated lines into a single `×N` row.
- Copy-to-clipboard now works over plain-HTTP LAN (legacy fallback).
- New **original logo/icons** (no third-party marks) plus `docs/LEGAL.md`,
  `NOTICE`, TMDB attribution, and not-affiliated disclaimers.

## 2.2.0 — Redesign, System panel & Python 3.14 (2026-08-16)

### System panel
- New **System** area (like Sonarr/Radarr) with four tabs:
  - **Status** — live health checks (Telegram, scanner, disk space, download
    queue, database integrity) plus app/host info (version, Python, platform,
    uptime, DB size, disk, data dir).
  - **Tasks** — per-channel scan schedules with interval, days, last-run and
    next-run times, plus "Scan all now" and per-task run.
  - **Backup** — one-click consistent DB+settings snapshots (SQLite online
    backup API), listed with download/delete; keeps the latest 10.
  - **Updates** — installed version vs the latest GitHub release, with a link to
    the release notes.
- New `app/system.py` module and `/api/system/*` endpoints (auth-guarded;
  backup filenames validated against path traversal).

### Python 3.14 + dependency refresh
- Runtime moved to **Python 3.14-slim**; CI now tests on 3.14 to match.
- Bumped **cryptg** 0.5.0.post0 → 0.5.2 (ships prebuilt cp314 wheels, so the
  AES-NI backend keeps working on 3.14; still compatible with 3.13).
- Dependency bumps: jinja2 3.1.6 (security), python-multipart 0.0.32,
  ruff 0.16, pytest 9.1, pytest-asyncio 1.4; GitHub Actions checkout@v7 /
  setup-python@v7.

### Apple-inspired redesign
- Rebuilt the entire visual language around a precision-editorial **Apple**
  aesthetic: pale-gray/white surfaces, SF Pro typography, a single restrained
  blue accent, signature blue-capsule CTAs, iOS-style toggles, purposeful radii
  (18px cards / 12px controls / 980px pills), and softly restrained depth.
- **Light and dark are both first-class** (system-aware, plus the theme toggle).
- New clean blue app logo/favicon; donut, sparkline, poster grid, hero drawer,
  command palette, and login all reskinned; screenshots recaptured in light mode.

### Telegram
- **In-app sign-in wizard** — connect an account entirely from the browser
  (phone → login code → optional 2FA password); `authorize.py` is no longer needed.
- **Channel picker** — lists the channels/groups the account already follows so you
  pick from a list instead of copying IDs from web Telegram; still accepts
  `@username`, `t.me`, and invite links, joining them automatically.
- **Saved-Messages notifications** — completed downloads are DM'd to your Telegram
  Saved Messages with the poster image and an "Open in Plex" deep link.

### UI
- Installable **PWA** (manifest + icons) with SVG favicon and gradient brand identity.
- **Real-time SSE** live updates (stats, active downloads, speed) — no more polling lag.
- **⌘K command palette** for navigation and actions.
- Dashboard: **storage donut**, animated count-up stats, and a **live download-speed sparkline**.
- Channels are now a **poster library** — TMDB art via a server-side proxy (API key
  never hits the browser) with a keyless IMDb fallback when no TMDB key is set.
- **Hero detail drawer** — full-bleed backdrop, synopsis, rating, and recent
  downloads for the selected title.
- Branded login screen, richer empty states, poster loading shimmer, micro-interactions, per-view page titles, theme-color + safe-area for mobile.
- README now documents every feature and embeds live screenshots (`docs/screenshots/`).

### Fixes
- `reset_client()` now disconnects the old Telethon client before dropping it,
  preventing two live clients sharing one session (`AUTH_KEY_DUPLICATED`).
- Scanner loop re-fetches the client each cycle and tolerates a mid-session
  re-auth (waits instead of crashing), resuming pending downloads once connected.

## 2.1.0 — \*arr integration + open-source scaffolding
Telearr can now plug into the \*arr stack, and the project has proper
open-source project files for external contributors.

### \*arr integration
- **Newznab-compatible indexer** at `http://<host>:8790/api/newznab` — add Telearr
  to Prowlarr/Sonarr/Radarr as a Newznab indexer (categories `5000` = TV,
  `2000` = Movies) and search Telegram channels like a usenet indexer.
- **SABnzbd-compatible download client** on the same host/port — Sonarr/Radarr add
  Telearr as a SABnzbd client; grabs resolve to Telegram messages and download
  through the existing fast pipeline, landing where the \*arr app imports them.
- New `releases` table maps synthetic Newznab release GUIDs back to
  `(channel_id, message_id)` so indexer results and SABnzbd grabs share a stable
  handle.
- API-key auth guards both APIs (managed from the Settings page).
- See `docs/ARR_INTEGRATION.md` for setup and known limitations of this young
  integration.

### Project / open source
- Rebranded to **Telearr** with a rewritten `README.md`.
- Added `LICENSE` (GPL-3.0, matching the \*arr ecosystem).
- Added `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` (Contributor Covenant v2.1), and
  `SECURITY.md`.
- Added `docs/ARCHITECTURE.md` (module map, data-flow diagram, DB schema, \*arr
  design) and `docs/ARR_INTEGRATION.md`.
- Added GitHub Actions CI (`.github/workflows/ci.yml`) running pytest on Python
  3.13, plus issue and pull-request templates.

## 2.0.0 — containerized, hardened, optimized rewrite
Schema/session-compatible with v1 (imported by `deploy.sh`).

### Speed
- cryptg (AES-NI) in the image.
- Parallel multi-sender downloader with preallocation + automatic sequential fallback.
- Right-sized worker/concurrency defaults; all tunable via env.

### Reliability
- Throttled progress writes; WAL auto-checkpoint on boot.
- Added `idx_dl_chan_gk`, `idx_dl_status`, `idx_logs_chan_id`.
- Strong refs on background tasks; crash-resume of interrupted downloads.
- Bounded container logs.

### Security / architecture
- Non-root (`PUID/PGID`); 127.0.0.1 bind by default.
- Secrets in `0600 .env`; pinned deps; multi-stage build.
- Normalizes bare channel ids to `-100…` form on add.

### Features
- 4K/1080p auto-routing by detected quality.
- Targeted Plex refresh; completion webhooks; episode-title cleanup.
- Underscore-separator episode parsing (`Season_15_Episode_1`, `S15_E02`, …).
