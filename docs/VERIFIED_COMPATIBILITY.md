# Verified *arr Compatibility

Telegrarr's *arr integration has been tested against **live** *arr instances (not mocks),
using each app's own `/test` validators (which build the request from the app's schema,
so the payloads are exactly what the app itself sends).

## Results

| App | Version | Newznab indexer | SABnzbd download client |
| --- | --- | --- | --- |
| Sonarr | 4.0.19.2979 | ✅ PASS | ✅ PASS |
| Radarr | 6.3.0.10514 | ⚠️ caps + search valid; "no results in cat 2000" until a **movie**-kind channel exists | ✅ PASS |

**Grab lifecycle** (the full flow Sonarr uses) was exercised directly:
`GET enclosure .nzb` → `POST mode=addfile` (multipart) → `{"status":true,"nzo_ids":["telearrNNN"]}`
→ the **same `nzo_id`** appears in `mode=queue`. `history` then reports the finished
`storage` path Sonarr imports from. The `nzo_id` is identical across addfile → queue →
history (this consistency is the single most common shim failure — verified correct here).

**Download ids per attempt.** The `nzo_id` identifies an *attempt* at a download, not only
the download row. The first attempt is `telearr<row id>` (the form handed out by earlier
versions, which keeps working for queue, history and delete). Every re-queue of a row that
had `failed` or been `cancelled` (UI retry, bulk retry, auto-retry, or an *arr re-grab of
the same message) starts a new attempt reported as `telearr<row id>-<attempt>`, so the *arr
tracks it as a new download instead of one it has already written off as failed. A re-grab
of a row that is still queued or downloading keeps its current id. A queue or history
delete acts only when the id is the row's current attempt; an id from an earlier attempt
changes nothing.

## Things this testing caught and fixed

- **`config.categories` must be objects**, not strings — Sonarr/Radarr deserialize them
  into `SabnzbdCategory`. Fixed; regression-tested.
- **caps advertised params we didn't honor** (`tvdbid`) — trimmed to `q,season,ep,imdbid`
  (TV) / `q,imdbid` (movie), which is what the search actually respects.
- **categories now use quality subcats** (TV 5040/5045, Movies 2040/2045) via a second
  `newznab:attr name="category"`, so 4K vs HD is expressed correctly.

## Operational notes (important for real use)

1. **Cross-container paths / Remote Path Mapping.** Telegrarr reports the container-internal
   `storage` path (e.g. `/media/TvShows/1080p/Show/…`). If Sonarr/Radarr mount the library
   at a different path, add a **Remote Path Mapping** in the *arr app: Host = Telegrarr's host,
   Remote Path = Telegrarr's path prefix (`/media`), Local Path = the *arr app's mount. If both
   share the same host paths, no mapping is needed.
2. **History retention vs import timing.** Sonarr imports by polling `history`. Keep
   `Settings → Keep per show` at **0 (keep all)** — or comfortably high — when using the
   *arr integration, so a just-completed grab isn't pruned before Sonarr imports it.
3. **Movie search returns nothing until you add a `movie`-kind channel.** Radarr's indexer
   test wants ≥1 result in category 2000; that's content, not a protocol issue.
4. **API key** is shared with the *arr apps (Settings → Sonarr/Radarr/Prowlarr card). It is
   embedded in feed URLs, so run Telegrarr on a trusted LAN or behind TLS.
5. **Removing from history in the *arr app** (e.g. "Remove failed downloads") only hides a
   finished item from the SABnzbd history Telegrarr reports. The row stays in Telegrarr's
   Downloads view and files are never deleted, whatever `del_files` says. Deleting a queued or
   downloading item cancels it.

## How to wire it up

- **Prowlarr / Sonarr / Radarr → Indexer → Newznab**: URL `http://<host>:8790/api/newznab`,
  API Path `/api`, API Key from Settings. Categories 5000 (TV) / 2000 (Movies).
- **Sonarr / Radarr → Download Client → SABnzbd**: Host `<host>`, Port `8790`, API Key from
  Settings, Category `tv` / `movies`.

Both pass their **Test** button, as demonstrated above.
