# Telegrarr Architecture

Telegrarr is a single-process FastAPI application (Python 3.13) built on the
[Telethon](https://docs.telethon.dev/) MTProto client. One uvicorn worker serves
the web UI and JSON API **and** runs the background scanner in the same event loop.

> **Single-worker invariant.** The scanner (`app/scanner.py`) holds process-wide
> asyncio state — a semaphore, an in-flight map (episode → the attempt and task
> holding its slot), and a task registry. This is
> correct **only** under a single event loop / single uvicorn worker. The container
> runs `--workers 1`; do not raise that without first moving the scanner into its
> own process.

## Module map

| Module | Responsibility |
| --- | --- |
| `app/config.py` | 12-factor config. Reads every setting from environment variables (Telegram creds, library paths, download tuning, web/auth, integrations). Nothing secret is hard-coded. Exposes `summary()` — a non-secret view for the status panel. |
| `app/db.py` | SQLite access layer. Opens WAL-mode connections with tuned pragmas, defines the schema (idempotent `CREATE ... IF NOT EXISTS`) and indexes, and provides the `conn()` context manager (commit on success, rollback on error) plus `log()` for persisting user-facing events. |
| `app/settings.py` | DB-backed runtime settings with env-based defaults. `get/set` plus typed getters, a `public()` view (secrets reported as booleans only), and a `WRITABLE` allowlist with per-key coercers so the UI can change tunables live without a rebuild. |
| `app/auth.py` | Authentication. bcrypt password hashing, a signed session cookie (`itsdangerous`), seeding the default admin on first run, and the `require_user` dependency guarding the API. |
| `app/tg.py` | The single shared Telethon client, configured with connection retries, auto-reconnect, and a flood-sleep threshold for a resilient long-lived connection. Also hosts the **interactive web sign-in** flow (`send_code` → `sign_in_code` → `sign_in_password`), account status/logout, `list_dialogs()` (the account's channels/groups for the picker), and `resolve()` (turn a `@username` / `t.me` / invite link / id into a chat, joining it if needed). `reset_client()` disconnects before dropping the client so one session never has two live clients. |
| `app/namer.py` | Pure parsing/naming logic. Extracts season/episode/date/quality from filenames and captions, detects UHD, computes a per-episode `group_key` for dedup, cleans episode titles, queries IMDb suggestions, and builds the final Plex-style `save_path`. |
| `app/downloader.py` | The fast downloader. A parallel multi-sender ("FastTelethon") engine that splits a file into part-ranges, fetches each range on its own exported sender, and `pwrite`s into a preallocated file — with an automatic fallback to Telethon's built-in sequential downloader if the fast path raises. Enforces a minimum-free-space check and a global flood-wait gate. |
| `app/scanner.py` | The orchestrator. Polls enabled channels on schedule, keeps the largest file per episode, enqueues and runs downloads under a concurrency semaphore, drives progress updates, prunes history, and triggers Plex refresh + notifications. Also handles pause/resume and crash-resume of interrupted downloads. |
| `app/plex.py` | Targeted Plex refresh. Finds the library section whose path best matches the download folder and refreshes only that path, so new media appears in seconds. Includes a connectivity `test()`. |
| `app/notify.py` | Fire-and-forget completion notifications: a generic webhook (Discord/Slack-compatible JSON) **and** a rich Telegram Saved-Messages DM (poster image downloaded and sent as a photo, plus an "Open in Plex" deep link). Includes a `test()`. |
| `app/tmdb.py` | Poster/backdrop art resolver. Prefers TMDB when an API key is set (server-side proxy, so the key never reaches the browser) and falls back to the keyless IMDb suggestion API otherwise; returns poster, backdrop, overview, year, and rating. Includes a `test(key)` that validates a supplied key. |
| `app/arr.py` *(2.1.0 integration layer)* | The \*arr bridge. Serves the Newznab-compatible indexer API and the SABnzbd-compatible download-client API, translating Telegram messages into "releases" and \*arr grabs into downloads on the existing scanner/downloader pipeline. See [ARR_INTEGRATION.md](ARR_INTEGRATION.md). |
| `app/main.py` | The FastAPI app. Wires the lifespan (DB init, admin seed, Telegram connect, scanner start, graceful shutdown), serves the web pages and static assets, and exposes the JSON API (status, channels, downloads, IMDb search, logs, settings, account, queue control, integration tests). Adds the **SSE stream** (`/api/events`, pushing a live status/downloads snapshot), the **art proxy** (`/api/art`), and the **Telegram onboarding endpoints** (`/api/telegram/*` — auth status, send-code, sign-in, dialogs, resolve). |

## Data flow

The core pipeline runs entirely inside the scanner's event loop:

```mermaid
flowchart TD
    subgraph poll["Scan loop (scanner.scan_loop)"]
        A[Timer ticks every 30s] --> B{Paused?}
        B -- yes --> A
        B -- no --> C[For each enabled channel]
        C --> D{Due this weekday<br/>and past poll interval?}
        D -- no --> C
        D -- yes --> E[scan_channel]
    end

    E --> F[iter_messages newest→older<br/>stop at last_message_id]
    F --> G["Dedup: keep largest file<br/>per group_key (namer.group_key)"]
    G --> H{Already have<br/>≥ this size?}
    H -- yes --> C
    H -- no --> I[_enqueue: resolve save_path<br/>insert 'queued' row + spawn]

    I --> J[_run_download]
    J --> K{Semaphore slot<br/>and not paused?}
    K --> L[download_file]
    L --> M{Fast multi-sender path}
    M -- ok --> N[atomic os.replace .tmp → save_path]
    M -- raises --> O[fallback: Telethon sequential] --> N
    N --> P[mark 'completed' + prune history]
    P --> Q[plex.refresh_path]
    P --> R[notify.send]

    subgraph arr["*arr integration (2.1.0)"]
        S[Sonarr/Radarr/Prowlarr] -->|Newznab search| T[/api/newznab]
        T -->|release list from channels| S
        S -->|SABnzbd addurl grab| U[SABnzbd shim]
        U -->|enqueue| J
    end
```

Step by step:

1. **Scan.** `scan_loop` wakes every 30s. For each enabled channel that is due
   (right weekday, poll interval elapsed), `scan_channel` iterates messages from
   newest toward `last_message_id`.
2. **Dedup.** `_iter_best` groups media by `group_key` (season/episode, else
   episode, else air date, else message id) and keeps only the **largest** file per
   group. `_already_have` skips groups already downloaded/queued at equal-or-greater
   size.
3. **Download.** `_enqueue` resolves the Plex-style `save_path`, writes a `queued`
   row, and spawns `_run_download`, which acquires the concurrency semaphore and
   calls `download_file`. The downloader preallocates a `.tmp`, fetches part-ranges
   in parallel, verifies the final size, and atomically renames into place.
4. **Name.** The path was computed by `namer.build_save_path` from the parsed show
   title (IMDb-mapped if set), season, episode, and cleaned episode title, and
   routed to the 1080p or 4K library based on detected quality.
5. **Plex refresh + notify.** On completion the row is marked `completed`, history
   is pruned to the retention limit, `plex.refresh_path` refreshes the matching
   library section, and `notify.send` posts the webhook.

Interrupted downloads are re-queued on graceful shutdown and resumed on the next
boot (`resume_pending_downloads`).

## Database schema

SQLite (WAL mode) at `${TELEARR_DATA_DIR}/telearr.db`. The schema is
backward-compatible with telearr v1, so an existing database imports cleanly.

- **`users`** — `username` (PK), `pw_hash` (bcrypt). Seeded on first run.
- **`channels`** — watched Telegram channels: `id` (PK), `chat_id` (unique, `-100…`
  form), `title`, `kind` (`tv`/`movie`/other), `imdb_id`, `imdb_title`, `weekdays`
  (CSV of 0–6), `poll_minutes`, `enabled`, `last_scanned_at`, `last_message_id`,
  `created_at`.
- **`downloads`** — one row per media item: `id` (PK), `channel_id`, `message_id`,
  `file_unique_id`, `group_key`, `file_name`, `file_size`, `save_path`, `status`
  (`queued`/`downloading`/`completed`/`failed`/`cancelled`), `error`, `progress`,
  `speed_mbs`, `started_at`, `finished_at`, `created_at`. Unique on
  `(channel_id, message_id)`.
- **`imdb_candidates`** — cached IMDb suggestions per channel: `(channel_id, rank)`
  PK, `imdb_id`, `title`, `year`, `kind`.
- **`logs`** — user-facing event log: `id` (PK), `ts`, `level`, `message`,
  `channel_id`. Surfaced on the Activity page.
- **`settings`** — key/value runtime settings written by the UI.
- **`releases`** *(2.1.0 integration layer)* — the Newznab view of discovered
  media, mapping a synthetic release id/GUID to a `(channel_id, message_id)` so that
  a Newznab search result can be resolved back to a Telegram message when the
  matching SABnzbd grab arrives. Lets the indexer and download-client APIs share a
  stable handle for each release.

Indexes: `idx_dl_chan_gk` on `downloads(channel_id, group_key)`, `idx_dl_status` on
`downloads(status)`, `idx_logs_chan_id` on `logs(channel_id, id)`.

## \*arr integration architecture

The integration reuses the existing scanner/downloader pipeline and adds a thin
protocol-translation layer (`app/arr.py`) with three parts:

1. **Newznab indexer** — `GET /api/newznab` implements the Newznab `caps`, `search`,
   `tvsearch`, and `movie` functions. Telegrarr maps its watched channels and their
   discovered media into Newznab release entries (categories `5000` = TV,
   `2000` = Movies), so Prowlarr/Sonarr/Radarr can search Telegram like any usenet
   indexer. Each release carries a GUID that resolves to a `releases` row.
2. **SABnzbd shim** — a SABnzbd-compatible API on the same host/port. Sonarr/Radarr
   add Telegrarr as a SABnzbd download client; when they grab a release they call the
   shim's `addurl`/`addfile` mode, which Telegrarr resolves (via the release GUID) to
   a Telegram message and hands to the scanner's download path. Queue/history
   endpoints report status back to the \*arr app so it can track and import.
3. **On-demand grab** — a grab enqueues into the same `_run_download` pipeline as an
   organic scan, so it shares the fast multi-connection downloader, the concurrency
   semaphore, dedup, naming, and the completed file lands where the \*arr app expects
   it for import.

This design keeps the \*arr surface small and stateless-ish: discovery and download
still flow through the battle-tested scanner, and the API layer only translates
protocols and resolves GUIDs. See [ARR_INTEGRATION.md](ARR_INTEGRATION.md) for setup
and current limitations.

## Front-end architecture (v2.1 UI overhaul)

The web UI is a **buildless, dependency-free single-page app** written in native
ES modules. There is no bundler, transpiler, or npm step: `index.html` loads one
`<script type="module" src="/static/js/main.js">`, the browser resolves the relative
imports over HTTP, and a single hand-authored stylesheet (`app/static/app.css`)
carries the whole design system. FastAPI serves these as ordinary static files.

### Module split

Four modules, each with a single clear responsibility:

| Module | Responsibility |
| --- | --- |
| `app/static/js/core.js` | Framework-free foundation. The hyperscript DOM builder `h(tag, attrs, ...kids)` (children become **text nodes**, so interpolated data is escaped by construction; `innerHTML` is reachable only via an explicit `html:` attribute reserved for trusted SVG), the `mount`/`clear`/`qs` helpers, a tiny reactive `createStore`, the `toast()` notifier, the `api()`/`jpost()`/`jpatch()` fetch client (centralised `401 → /login` redirect and toast-on-error), a `copy()` clipboard helper, and the formatters (`gb`, `fmtBytes`, `fmtETA`, `base`). |
| `app/static/js/icons.js` | A pure data module: a `PATHS` map of Feather/Lucide-style SVG path bodies and an `icon(name)` function that wraps them in an inline `<svg aria-hidden="true">` inheriting `currentColor`. No DOM, no state. |
| `app/static/js/views.js` | One pure view-builder per route — `viewDashboard`, `viewChannels`, `viewDownloads`, `viewActivity`, `viewSettings` — plus the add/edit **channel modal** (`openChannelModal`, rendered into a separate `#modal-root`). Each builder returns a DOM subtree built with `h()`, with event handlers attached inline. Transient view state (active tab, search query, sort, density, the selection `Set`, expanded groups) lives in an exported mutable `ui` object, persisted to `localStorage` where it helps. |
| `app/static/js/main.js` | The application shell and controller: builds the sidebar + sticky topbar + mobile bottom-nav once (`buildShell`), does hash-based routing (`#/<view>`), owns the client-side data cache `DATA` and the polling loop, keeps the shell chrome in sync (`syncNav`, `updateShell`, `syncThemeBtn`), and manages the tri-state (`auto`/`light`/`dark`) theme persisted to `localStorage` and applied via a `data-theme` attribute on `<html>`. |

### The render / refresh / rerender ctx contract

Views never touch globals directly; they receive a single **`ctx`** object
constructed once in `main.js` and threaded through every builder and handler:

```
ctx = {
  get data(),            // live view of the DATA cache { status, downloads, channels }
  refresh(),             // async: re-fetch data for the active view, then render()
  rerender(),            // sync: re-render the active view from the current cache
  getTheme(), setTheme() // tri-state theme accessors
}
```

- **`render()`** rebuilds `#view-root` wholesale — `mount(root, NAV.find(...).view(ctx))`
  — with no virtual DOM and no diffing. Before replacing the subtree it captures the
  active element's `id` and caret position and best-effort restores focus/selection
  afterward (elements without an `id`, e.g. checkboxes, are not preserved).
- **`refresh()`** is the "data changed" path: a handler mutates server state
  (`await api(...)`), then calls `ctx.refresh()` to re-fetch and repaint.
- **`rerender()`** is the "view state changed" path: switching tabs, typing in the
  filter, toggling a group — mutate the `ui` object, then repaint from cache without a
  network round-trip.
- A background `setInterval` polls `/api/status` (and downloads) every 2.5s via
  `fetchForView()` and re-renders **only** the dashboard and downloads views, so
  progress bars stay live without disturbing other pages. The modal renders into
  `#modal-root`, outside `#view-root`, so polling re-renders never tear it down.

### Design rationale (why buildless)

The no-bundler choice is deliberate. The API surface is small and the data model is
simple, so a full re-render on every change is cheap and removes an entire class of
state-sync bugs; native ESM means zero toolchain, zero lockfile, and instant
deploys (edit a file, refresh). XSS safety is a property of the `h()` primitive
rather than a lint rule — text is always a text node, and the only `innerHTML` sink
takes constant, in-repo SVG strings. The cost is manual DOM plumbing and module-global
mutable state (`DATA`, `ui`) instead of a reactive store; both are acceptable at this
size and have a clear upgrade path (the unused `createStore` in `core.js`). A
companion UX/accessibility review of this layer lives in
[UI_REVIEW.md](UI_REVIEW.md).
