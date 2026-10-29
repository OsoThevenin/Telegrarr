# Connecting Telegrarr to Sonarr, Radarr & Prowlarr

> **Telegrarr:** registration is now one click from the **Connect** page; the manual
> steps are in [CONNECT.md](CONNECT.md). This upstream guide is kept for background.

Telegrarr can act as **both** a Newznab indexer and a SABnzbd-compatible download
client, so your existing \*arr stack can treat Telegram channels as a usenet-like
source: search → grab → download → import, using the workflow you already run.

This guide walks through the setup. It assumes Telegrarr is running and reachable at
`http://<host>:8790` and that you've already added and mapped a channel or two in
the Telegrarr UI.

> **Heads up.** This integration is young. It works, but it is intentionally
> conservative and has [known limitations](#known-limitations). Read those before
> filing an issue.

---

## Overview

```
Prowlarr / Sonarr / Radarr
        │  (1) search            (2) grab
        ▼                            ▼
  Newznab indexer  ───────►  SABnzbd download client
  GET /api/newznab           (same host:8790, api key)
        │                            │
        └──────────► Telegrarr ◄────────┘
                        │
             existing scanner + fast downloader
                        │
                Plex-ready library  →  Sonarr/Radarr import
```

---

## Step 1 — Get your API key

1. Open the Telegrarr web UI at `http://<host>:8790` and log in.
2. Go to **Settings**.
3. Copy the **API key** shown there. This single key authenticates both the
   Newznab indexer and the SABnzbd client. Treat it like a password — anyone with
   it can enqueue downloads.

If you rotate the key later, update it in every \*arr app that uses it.

---

## Step 2 — Add Telegrarr as a Newznab indexer

You can add it in **Prowlarr** (recommended — it then syncs to Sonarr/Radarr) or
directly in Sonarr/Radarr. The fields are the same.

**In Prowlarr:** *Settings → Indexers → Add Indexer → Generic Newznab.*
**In Sonarr/Radarr:** *Settings → Indexers → Add → Newznab.*

| Field | Value |
| --- | --- |
| Name | `Telegrarr` |
| URL | `http://<host>:8790/api/newznab` |
| API Path | `/api/newznab` |
| API Key | the key from Step 1 |
| Categories | `5000` (TV) for Sonarr, `2000` (Movies) for Radarr |

Notes:

- Use the host/IP where Telegrarr runs, reachable from the \*arr container/host. If
  everything is on one Docker network, use the service name (e.g.
  `http://telearr:8790/api/newznab`).
- **Categories** follow the Newznab standard: `5000` = TV, `2000` = Movies. Map
  Sonarr to TV and Radarr to Movies.
- Click **Test**. Telegrarr answers the Newznab `caps` request; a green test means
  the indexer is reachable and the API key is valid.

---

## Step 3 — Add Telegrarr as a SABnzbd download client

**In Sonarr/Radarr:** *Settings → Download Clients → Add → SABnzbd.*

| Field | Value |
| --- | --- |
| Name | `Telegrarr` |
| Host | `<host>` (or the Docker service name) |
| Port | `8790` |
| API Key | the same key from Step 1 |
| Use SSL | Off (unless you front Telegrarr with TLS) |
| Category | e.g. `tv` for Sonarr, `movies` for Radarr |

Click **Test**. Sonarr/Radarr will query the SABnzbd-compatible endpoints; a green
test means Telegrarr responded as a SABnzbd client.

> Set a **Category** so grabs are tagged and the \*arr app can find the finished
> files for import. Keep the category consistent with how your library paths are
> laid out.

---

## Step 4 — How grabs flow

1. **Search.** Sonarr/Radarr (directly or via Prowlarr) sends a Newznab
   `tvsearch`/`movie` query to `/api/newznab`. Telegrarr returns matching releases
   drawn from your watched Telegram channels, each with a GUID.
2. **Grab.** When the \*arr app decides to grab a release, it hands the download to
   its SABnzbd client — Telegrarr. Telegrarr resolves the release GUID back to the
   specific Telegram message.
3. **Download.** The grab is enqueued into Telegrarr's normal pipeline and pulled via
   the fast multi-connection downloader, subject to the same concurrency limit,
   dedup, and naming as an organic scan.
4. **Report & import.** Telegrarr reports queue/history status back through the
   SABnzbd endpoints. When the file completes, it lands in the library where the
   \*arr app expects it, and Sonarr/Radarr imports it as usual. Each SAB job is
   named after its Release title, as a real SABnzbd names a job after its NZB.

### TV Release titles

A TV Release title starts with **Sonarr's own series title** for the Channel's
mapped TVDB id, as is (`Example.Show.S05E26…`, `Old.Show.1979.S01E07…` for
*Old Show (1979)*), so Sonarr matches the Grab by name and imports it on its own.
When Sonarr is unreachable, not configured or lacks the series, the mapped title
(then the Channel title) is used, without a trailing year. Sonarr's title is
cached per TVDB id (`sonarr_titles`) and refreshed when the Channel is remapped.

Already-indexed Releases are retitled when a TV Channel is remapped, and once at
startup. The startup refresh only uses Sonarr's title: while Sonarr is down it
leaves titles as they are.

---

## Known limitations

This integration is new — please keep expectations calibrated:

- **Search quality depends on channel metadata.** Telegrarr matches on what channels
  actually post (filenames/captions). Poorly labeled channels yield poor Newznab
  results. Mapping a channel to an IMDb title in the UI improves naming and
  matching.
- **No true "grab anything" search.** Telegrarr can only offer what its channels have
  posted (and, depending on configuration, what it can backfill) — it is not a
  general usenet indexer.
- **Sizes/quality flags are best-effort.** Quality is inferred from filename tokens
  (`1080p`, `2160p`, etc.); releases without clear tokens may be categorized
  imperfectly.
- **One download at a time by default.** `TELEARR_MAX_CONCURRENT` defaults to `1`;
  \*arr grabs queue behind organic scans and each other.
- **Categories are limited** to TV (`5000`) and Movies (`2000`). Anime, and finer
  sub-categories, are not specifically modeled yet.
- **Single-instance / single-worker.** Telegrarr runs one scanner in one process; the
  indexer/client APIs share that process.
- **Protocol coverage is partial.** Telegrarr implements the SABnzbd/Newznab
  functions the \*arr apps actually call, not the entire specifications. If your \*arr
  version calls something unimplemented, please open an issue with the request
  details.

Found a gap or a bug? Please file an issue with your Sonarr/Radarr/Prowlarr
versions and the exact request/response — that's the fastest way to get it fixed.
