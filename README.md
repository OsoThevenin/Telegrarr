# Telegrarr

**English** · [Català](README.ca.md)

[![CI](https://github.com/OsoThevenin/Telegrarr/actions/workflows/ci.yml/badge.svg)](https://github.com/OsoThevenin/Telegrarr/actions/workflows/ci.yml)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/OsoThevenin/Telegrarr)](https://github.com/OsoThevenin/Telegrarr/releases)
![Python 3.13](https://img.shields.io/badge/python-3.13-blue)

**Telegram channels as a usenet-style source for Sonarr and Radarr, tuned for
Catalan content.** Telegrarr exposes the Telegram channels you follow as a
**Newznab indexer** (search) and a **SABnzbd download client** (grab), so a Catalan
episode or film posted on Telegram reaches your library through the normal
Sonarr/Radarr import pipeline, with no manual steps.

Telegrarr is a fork of [Wishaal/Telearr](https://github.com/Wishaal/Telearr) v2.3.3.
Only user-facing branding changed: internal identifiers (`TELEARR_*` environment
variables, the `telearr_sess` cookie, `telearr.db`, module names) stay as upstream so
upstream fixes merge cleanly. It is a self-hosted
[FastAPI](https://fastapi.tiangolo.com/) + [Telethon](https://docs.telethon.dev/)
app (Python 3.13) that ships as one non-root Docker container.

See [CHANGELOG.md](CHANGELOG.md) for everything that changed against Telearr v2.3.3.

---

## How it works

```
Prowlarr ──sync──► Sonarr / Radarr
   │                   │ search (Newznab)        grab (SABnzbd)
   └──────────► Telegrarr :8790 ◄──────────────────────┘
                   │  reads the channels you mapped, downloads what was grabbed
                   ▼
   /downloads/telegram/<tv|movies>/<release name>/<file>  ──►  Sonarr/Radarr import
```

1. You add Telegram channels and map each one to a series (TVDB id) or mark it as a
   movie channel.
2. Telegrarr reads the channel posts, parses episode numbers and quality, and
   publishes each post as a release such as `Show.S03E13.CAT.1080p.WEB-DL.x264-TELEGRARR`.
3. Sonarr/Radarr search Telegrarr by TVDB/TMDB/IMDb id, grab a release, Telegrarr
   downloads it into `/downloads`, and the \*arr app imports it.

## Install (Docker Compose)

Requirements: Docker + Docker Compose, Telegram API credentials from
<https://my.telegram.org>, and a free [TMDB API key](https://www.themoviedb.org/settings/api)
(required to map channels).

```bash
cp .env.example .env
$EDITOR .env      # TG_API_ID, TG_API_HASH, TELEARR_SECRET_KEY, TELEARR_ADMIN_PASS, PATH_TO_DOWNLOADS
docker compose up -d
```

The image is published to GHCR on every release:

```
ghcr.io/osothevenin/telegrarr:latest
ghcr.io/osothevenin/telegrarr:1.0.0
```

The bundled `docker-compose.yml` builds locally (`build: .`); to use the prebuilt
image, remove `build: .` and set `image: ghcr.io/osothevenin/telegrarr:1.0.0`.

### Downloads folder

- The container runs as **non-root UID/GID 1000**. The host folders mounted at
  `/data` and `/downloads` must be writable by UID 1000 (`chown -R 1000:1000 …`), or
  uncomment `user:` in `docker-compose.yml` and set `PUID`/`PGID` to the owner of
  your disk.
- `PATH_TO_DOWNLOADS` (in `.env`) is the **host** folder mounted at `/downloads`.
  Mount the same host folder at `/downloads` in Sonarr and Radarr as well: grabs land
  in `/downloads/telegram/<tv|movies>/<release name>/<file>`, which is then the same
  path in all three containers, so no Remote Path Mapping is needed.
- `TELEARR_DOWNLOADS_DIR` is the downloads base **inside** the container (default
  `/downloads`). It can also be changed in *Settings → Downloads*.

### Operating mode

| `operating_mode` | Behaviour |
| --- | --- |
| `arr` (default, supported) | Scans only index channel posts. Nothing is downloaded until Sonarr/Radarr grab it. |
| `standalone` | Upstream Telearr behaviour: every new episode is downloaded straight into the library folders (`TELEARR_TV_DIR`, …) with optional Plex refresh. Kept, but not supported. |

Switch it in *Settings → Downloads* (**Standalone mode** toggle).

Open **http://\<host\>:8790**, log in with the admin credentials from `.env`, and
press **Connect Telegram**: the in-app wizard asks for phone number, login code and
(optional) 2FA password.

## Connect Prowlarr, Sonarr and Radarr

Open **Connect** in the sidebar, enter the URL (as reachable from Telegrarr) and API
key of Prowlarr, Sonarr and Radarr, press **Save & test**, then **Register
Telegrarr**. This creates:

- in Prowlarr, a Generic Newznab indexer named `Telegrarr` (API path `/api/newznab`)
  that Prowlarr syncs to Sonarr and Radarr;
- in Sonarr and Radarr, a SABnzbd download client named `Telegrarr` (category `tv`
  / `movies`).

Pressing it again is safe: entries already named `Telegrarr` are left as they are.
The manual path (field by field) is in **[docs/CONNECT.md](docs/CONNECT.md)**. The
Sonarr connection is also used to read episode lists when resolving two-part
episodes (see below).

The Telegrarr API key is in *Settings → Integrations*.

## Channels

Add channels from **Channels → Add channel**: pick one from your Telegram chat list
or paste a `@username` / `t.me` link. Telegrarr **never joins channels for you**: join
them in the Telegram app first.

- **Series channel** (one channel = one series): search the series on TMDB (Catalan
  titles first, English fallback) or type the TVDB id directly. TMDB and IMDb ids are
  derived from it. Sonarr then finds releases by TVDB id.
- **Movie channel** (one channel, many films): each post's title and year are looked
  up on TMDB (`ca-ES`, then `en-US`). Movie channels need the TMDB key. Films without
  a confident match go to **Review**, where you pick the right film or discard the
  post.
- Each channel has an **audio language** (`cat` default, `es`, `en`, `multi`) and a
  **fallback quality**, used when Telegram does not report the video size.

The TMDB key goes in *Settings → Integrations → Artwork (TMDB)*.

### Import from a directory channel

Some channels just post links to one channel per series. **Channels → Import
directory** reads such a channel, lists the linked channels with a suggested TMDB
match, and adds the ticked ones in one go. Limits, to keep the account safe:

- Telegrarr does **not join** anything: private invite links to channels you are not
  a member of are listed but cannot be imported until you join them in Telegram.
- Only the **newest 300 messages** of the directory are read.
- At most **60 links are resolved per scan**; the rest are reported and resolved on
  a later scan.
- A directory is read from Telegram at most once every **15 minutes**; scanning again
  sooner reuses the cached result.
- Channels without a TMDB match are imported **unmapped**; map them afterwards from
  the channel dialog.

## Catalan parsing

Telegrarr reads episode numbers from the file name or the caption. Underscores count
as spaces (`El_Senyor_dels_Anells_1x01_Una_ombra_del_passat.avi`). Markers are
recognised anywhere in the text:

| Form | Example |
| --- | --- |
| `NxNN` | `3x13 Un viatge pel temps` |
| `TnCnn` / `TnnEnn` | `T3C13`, `T03E13` |
| Temporada + Capítol | `Temporada 3 Capítol 13` |
| Capítol / Episodi | `Cap. 13`, `Cap 13`, `C13`, `Episodi 13`, `Ep. 13` |
| English forms | `S03E13`, … |
| Double episodes | `1x01-02`, `1x01-1x02` |

- The **episode title** is the text after the marker; on mapped channels, text before
  the marker is ignored.
- **`(1a Part)` / `(2a Part)`** stay in the title and are resolved to the real
  episode number: Telegrarr reads the season's episode list from TMDB in Catalan,
  then TMDB in English, then Sonarr. If two consecutive episodes share the base
  title, part N becomes base episode + N − 1; otherwise the channel numbering is
  kept. Matching ignores accents and tolerates small differences.
- **Quality** comes from the video dimensions Telegram reports: ≥ 3200×2000 →
  `2160p`, ≥ 1800×1000 → `1080p`, ≥ 1200×700 → `720p`, smaller → `SDTV`. Without
  dimensions the channel's fallback quality is used.

## Release names

Releases are named so existing Sonarr/Radarr custom formats can score them:

```
Show.S03E13.CAT.1080p.WEB-DL.x264-TELEGRARR
Title.2019.CAT.1080p.WEB-DL.x264-TELEGRARR
```

The language token comes from the channel's audio language: `CAT`, `SPA`, `ENG` or
`MULTI`. The release group is always `TELEGRARR`.

## Account safety

Telegrarr signs in with your **personal** Telegram account, so it behaves like a
calm desktop client:

| Setting | Default | Where |
| --- | --- | --- |
| Parallel senders per file | 4 | *Settings → Downloads → Performance*, `TELEARR_DL_WORKERS` |
| Concurrent files | 2 | *Settings → Downloads → Performance*, `TELEARR_MAX_CONCURRENT` |
| Channel poll interval | ≥ 15 min, plus random jitter; lower values are rejected | per channel, default in *Performance* |
| Daily download budget | 0 GB = unlimited; when reached, downloads pause until the next day | *Performance* |
| FloodWait | global gate with exponential back-off; a notification when one wait exceeds 10 min | automatic |
| Client fingerprint | official desktop client (`Desktop` / `Windows 10` / `5.12.3 x64`) | `TELEARR_TG_DEVICE_MODEL`, `TELEARR_TG_SYSTEM_VERSION`, `TELEARR_TG_APP_VERSION` |
| Channel joins | never automatic | — |

One persistent session file is kept in `/data`.

## Interface language

The UI is in **Catalan by default**. Switch to English in *Settings → Account →
Appearance* (*Configuració → Compte → Aparença*). The choice covers the UI, error
messages and notifications.

## Configuration reference

Deploy-time settings live in `.env` (see [`.env.example`](.env.example)); many can be
changed live in *Settings*, which override `.env`.

| Variable | Purpose | Default |
| --- | --- | --- |
| `TG_API_ID` / `TG_API_HASH` | Telegram API credentials | required |
| `TELEARR_SECRET_KEY` | Session-cookie signing key | set a strong random value |
| `TELEARR_ADMIN_USER` / `TELEARR_ADMIN_PASS` | Seed admin login (first run) | — |
| `PATH_TO_DOWNLOADS` | Host folder mounted at `/downloads` | `./downloads` |
| `TELEARR_DOWNLOADS_DIR` | Downloads base inside the container | `/downloads` |
| `TELEARR_MEDIA_ROOT` | Host path mounted at `/media` (standalone libraries; unused in *arr mode) | `./media` |
| `TELEARR_BIND_ADDR` | Host address the UI binds to | `0.0.0.0` |
| `PUID` / `PGID` | Only if you enable `user:` in compose | `1000` |
| `TELEARR_DL_WORKERS` / `TELEARR_MAX_CONCURRENT` | Senders per file / concurrent files | `4` / `2` |
| `TELEARR_MIN_FREE_GB` | Refuse downloads below this free space | `50` |
| `TELEARR_PROXY` | Route Telegram through a proxy | — |
| `PLEX_URL` / `PLEX_TOKEN`, `TELEARR_NOTIFY_WEBHOOK` | Optional upstream integrations | — |

## Proxy / VPN

If downloads stall on one Telegram data center, your ISP may be throttling Telegram.
Set a proxy in *Settings → Integrations → Proxy / VPN* (or `TELEARR_PROXY`):
`socks5://[user:pass@]host:port`, `socks4://host:port`, `http://[user:pass@]host:port`
or `mtproxy://<secret>@host:port`. Only Telegram traffic uses it; a bad proxy falls
back to a direct connection.

## HTTPS

Service-worker install and copy-to-clipboard need `https://` (or `localhost`). Put
Telegrarr behind a reverse proxy with TLS (Caddy, Nginx Proxy Manager, Tailscale
Serve…). The app reads `X-Forwarded-Proto` and marks the session cookie `Secure`.

## Screenshots

| Dashboard | Channels |
| --- | --- |
| ![Dashboard](docs/screenshots/dashboard.png) | ![Channels](docs/screenshots/channels.png) |

| Downloads | Settings |
| --- | --- |
| ![Downloads](docs/screenshots/downloads.png) | ![Settings](docs/screenshots/settings.png) |

## Security

- Non-root image (UID/GID 1000) with `no-new-privileges` in compose.
- Keep secrets in `.env` (mode `0600`, never committed).
- The UI is protected by a bcrypt login; the Newznab/SABnzbd APIs by an API key
  (treat it like a password). **Do not expose port 8790 to the internet**; use a
  reverse proxy with TLS and an access list.

Report vulnerabilities as described in **[SECURITY.md](SECURITY.md)**.

## Legal and responsible use

Telegrarr downloads files from Telegram channels *you* choose into folders *you*
control; it hosts and ships no content. It is not affiliated with Telegram,
Sonarr/Radarr/Prowlarr, Plex or TMDB. This product uses the TMDB API but is not
endorsed or certified by TMDB. You are responsible for what you download. See
**[docs/LEGAL.md](docs/LEGAL.md)** and [`NOTICE`](NOTICE).

## Contributing and license

See **[CONTRIBUTING.md](CONTRIBUTING.md)**. Telegrarr, like Telearr, is licensed
under the **GNU General Public License v3.0** ([LICENSE](LICENSE)).
