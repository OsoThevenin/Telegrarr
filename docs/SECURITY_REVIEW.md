# Telearr Security Review

> **Telegrarr note (v1.0.0).** This review was written against upstream Telearr and is
> kept for history. Since then the `Dockerfile` sets `USER` (UID/GID 1000), so the image
> runs as non-root even with a bare `docker run`; compose adds `no-new-privileges`; and the
> channel-supplied filename is basename-sanitized before it becomes a save path. The
> "Container hardening" row and the matching checklist items below are resolved.

Scope: `app/main.py`, `app/arr.py`, `app/auth.py`, `app/scanner.py`, `app/downloader.py`,
`app/settings.py`, `app/db.py`, `app/namer.py`, `app/config.py`, `app/plex.py`,
`app/notify.py`, `app/tg.py`, `docker-compose.yml`, `Dockerfile`.

Review type: static read of source at revision present on disk. No code was changed and no
container/deploy was run. Threat model assumed: a self-hosted, single-admin service reachable
on the LAN, monitoring third-party Telegram channels whose *contents* are not trusted.

## Findings

| Severity | Location (file : concern) | Description | Recommendation |
|---|---|---|---|
| High | `namer.py:184` `build_save_path` (no-episode branch) | The fallback `return f"{base_dir}/{safe_show}/{filename}"` uses the **raw** Telegram `filename` (from `scanner._file_name` → the document's `file_name` attribute, fully controlled by whoever posted to the channel). Unlike `safe_show`, it is not passed through `_sanitize`, so a document named `../../../../data/telearr.db` (or any path the UID-1000 process can write) escapes the media root. `downloader.download_file` does `os.makedirs(dirname)` then `os.replace(tmp, save_path)`, giving an **arbitrary file write / overwrite** primitive. Triggered whenever a media item has no parseable season/episode (very common for movies / one-off files). | Sanitize the filename before use: apply `_sanitize` to `os.path.basename(filename)` and strip any leading `.`/separators, or reject names containing `/`, `\`, or `..`. Also containerize writes under a resolved-realpath check that the final path is inside `base_dir`. |
| Medium | `docker-compose.yml:9-10` + `Dockerfile:23` | App binds `0.0.0.0:8790` and publishes `8790:8790` to the host with **no TLS**. The session cookie, the admin password (sent as a form field on `POST /login`), and the *arr API key (also embedded in every Newznab feed/NZB URL as `&apikey=...`, see `arr.feed_xml:99`) all traverse the LAN in cleartext and are trivially sniffable/replayable. | Terminate TLS in front of the app (reverse proxy), or bind to `127.0.0.1` and reach it only through an authenticated proxy/VPN. Do not expose the raw port to the LAN. |
| Medium | `auth.py:9,45-56` session cookie | The cookie is signed with `itsdangerous.URLSafeSerializer` (**not** `URLSafeTimedSerializer`), so the signature itself has **no server-side expiry**. `max_age` on `set_cookie` (`main.py:72`) is only a browser hint. The payload holds just `{u, n}`; there is no session store, so `/logout` (`main.py:76`) only clears the client cookie and `set_password` does **not** invalidate outstanding tokens. A captured cookie is valid indefinitely, even after logout or password change, as long as `SECRET_KEY` is unchanged. | Switch to a timed serializer and validate `max_age` on `loads`; consider a server-side session/version counter (e.g. a `session_epoch` per user bumped on password change/logout) embedded in and checked against the token. |
| Medium | `arr.py:60-91` `search_releases` (Newznab search) | The query `SELECT r.* ... FROM releases r JOIN channels ch ...` has **no `LIMIT` and no search predicate in SQL** — it `.fetchall()`s the *entire* releases table into memory on every search and filters/limits in Python afterward. On a large library (backfill indexes every seen item) an authenticated *arr client (or anyone with the API key) can force large allocations per request. | Push `q`/`season`/`ep`/`imdbid`/category filters and the `LIMIT` into SQL; index accordingly. |
| Medium | `main.py:220,307` (`limit` params) + `main.py:459-464` (SAB `addfile`) | `api_downloads(limit=100)` and `api_logs(limit=200)` accept an unbounded caller-supplied `LIMIT` (e.g. `?limit=99999999`) with no cap. `_sab` `addfile` reads the whole uploaded body into memory (`await f.read()`) with no size limit before regex-scanning it. Both enable memory-pressure DoS (the first is session-auth'd, the second API-key-auth'd). | Clamp `limit` to a sane max (e.g. `min(limit, 500)`); cap the accepted upload size before `read()`. |
| Low | `plex.py:38,52` (and `plex.py:15,35`) | The Plex token is passed as a URL query param (`params={"X-Plex-Token": token}`). On failure, `log.warning("Plex refresh failed: %s", e)` and `test()`'s `{"detail": str(e)}` may serialize an httpx error whose message includes the full request URL — **leaking `plex_token` into container stdout logs and into the `/api/settings` test response**. | Send the token via the `X-Plex-Token` *header* instead of query params, and scrub tokens from exception strings before logging/returning. |
| Low | `main.py:66-73` `/login` | No rate limiting or lockout on login; unlimited password guessing is possible (bcrypt cost is the only brake). Combined with the weak `len(new) < 6` policy (`main.py:344`), online brute force is feasible for short passwords. | Add per-IP/per-account throttling and a temporary lockout; raise minimum password length (>= 12) and/or enforce complexity. |
| Low | `auth.py:34-37` `verify` | User enumeration via timing: a missing username returns immediately (`bool(r)` short-circuits) while an existing one pays the bcrypt cost. The HTTP response is uniform, so only a timing side channel exists. | Compare against a dummy bcrypt hash when the user is absent to equalize timing. |
| Low | `main.py:71-72` cookie flags | Cookie is `httponly` + `samesite=lax` (good) but has **no `Secure` flag** and there is **no CSRF token**. `samesite=lax` blocks cross-site POST/PATCH/DELETE and the JSON body requirement adds friction, so CSRF exposure on the state-changing API is limited; however `GET /logout` (`main.py:76`) remains CSRF-able (forced logout, low impact). | Set `secure=True` once behind TLS; if any state-changing GET is ever added, add a CSRF token. Consider making logout a POST. |
| Low | `settings.py:66`, `main.py:323` `/api/settings` | The full `notify_webhook` URL (which for Discord/Slack embeds a secret token) is returned in cleartext by `public()`. It is session-auth'd (admin-only), so exposure is limited, but it is a stored secret handed back over plaintext HTTP. | Report `notify_webhook_set: bool` like `plex_token_set`, or redact the token portion. |
| Info | `auth.py:9`, `config.py:46` `SECRET_KEY` fallback | If `TELEARR_SECRET_KEY` is unset, the signer silently falls back to `secrets.token_hex(32)` generated per process. The app still "works" but all sessions are invalidated on every restart, and the operator gets **no warning** that signing is ephemeral. | Fail fast (refuse to start) or emit a loud warning when `TELEARR_SECRET_KEY` is empty. |
| Info | `plex.py`, `notify.py` (outbound) | SSRF surface: `refresh_path`/`test` and `notify.send`/`test` fetch/POST to `plex_url` and `notify_webhook`, both set via the **session-authenticated, admin-only** `PATCH /api/settings`. An admin could aim them at internal hosts; `plex.test` echoes section titles and `notify.test` echoes the status code, forming a limited response oracle. Risk is low because the setter is already a trusted admin who controls the host. | Accept as admin-only; optionally block RFC1918/link-local targets or require a scheme/host allow-list if the trust model ever widens. |
| Info | Container hardening | Non-root is enforced only via compose `user: "${PUID:-1000}:${PGID:-1000}"` — the `Dockerfile` sets no `USER`, so a bare `docker run` would execute as **root**. No `no-new-privileges`, no read-only rootfs, no dropped capabilities. The `./data` and `/media/...` bind mounts are writable (relevant to the High finding above). | Add `USER 1000` in the Dockerfile as defense-in-depth; set `security_opt: [no-new-privileges:true]`, drop capabilities, and consider `read_only: true` with explicit tmpfs. |

## Verified good (no issue found)

- **AuthN/AuthZ coverage:** every mutating/data `/api/*` route in `main.py` declares `Depends(auth.require_user)`. The only unauthenticated routes are `/`, `/login`, `/logout`, `/healthz`, and the *arr endpoints. On the *arr side the only responses reachable **without** the API key are Newznab `t=caps` (`main.py:387`) and SAB `mode=version` (`main.py:433`) — both intended-public; every other mode/search/NZB path calls `arr.check_key` first and returns 401 on failure. No data endpoint is unintentionally public.
- **Timing-safe key check:** `arr.check_key` uses `secrets.compare_digest` (`arr.py:32`). The API key is a 128-bit `secrets.token_hex(16)`.
- **SQL injection:** all queries are parameterized. The one dynamically-built statement, `UPDATE channels SET {...}` in `api_patch_channel` (`main.py:178`), builds column names only from a hard-coded `allowed` whitelist and binds all values.
- **XML escaping:** `feed_xml` `html.escape`s the user/channel-derived `title` and the download URL (`arr.py:99,103`); other interpolated values (`channel_id`, `message_id`, `size`, `cat`) are integers from the DB. `nzb_xml` interpolates only ints. `caps_xml` is fully static.
- **ID coercion / path traversal on refs:** `newznab_nzb` splits `id` on `_` and forces `int(cid), int(mid)` (`main.py:402-405`); `arr.parse_ref` extracts via `telearr:(\d+):(\d+)` and returns ints (`arr.py:129-131`); `scanner.grab_message` uses `channel_id` only for a parameterized DB lookup and passes an int `message_id` to Telethon. No traversal via these refs.
- **SAB `addfile` handling:** the uploaded body is only regex-scanned by `parse_ref`; it is never written to disk or executed (`main.py:459-464`).
- **Secret exposure:** `settings.public()` exposes `plex_token_set` (bool) rather than `plex_token`; `config.summary()` exposes `plex`/`notify` as bools. `SECRET_KEY`, `TG_API_HASH`, and the bcrypt hash are not returned by any endpoint. (The *arr API key is returned by `/api/settings`, but that is session-auth'd and intentional — the UI displays it.) `db.log` calls do not pass secret values (e.g. key regeneration logs a message, not the key).
- **Passwords:** bcrypt with per-hash salt; change-password verifies the current password before updating (`main.py:342`). No default password is seeded unless `TELEARR_ADMIN_PASS` is explicitly set (`auth.py:25`).
- **Concurrency note:** the scanner relies on single-worker asyncio state; `Dockerfile` correctly pins `--workers 1`.

## Overall posture

For a single-admin, self-hosted media tool the fundamentals are sound: consistent
session/API-key gating on every data route, parameterized SQL throughout, timing-safe key
comparison, bcrypt password storage with a current-password check, proper XML escaping of
untrusted text, integer coercion on all external refs, no hard-coded default credentials, and
a non-root container. The most important gap is that **content pulled from third-party Telegram
channels is treated as trusted when building filesystem paths** — the unsanitized-filename
fallback in `build_save_path` is a genuine arbitrary-write primitive and should be fixed first.
After that, the deployment concerns dominate: the service is exposed to the LAN over plaintext
HTTP, and sessions never expire server-side and survive password changes. The remaining items
(unbounded queries, login brute-force, token-in-logs) are hardening rather than break-glass
issues. None of the outbound-request (SSRF) paths are reachable by an unauthenticated party.

## Hardening checklist (operators)

- [ ] Put Telearr behind TLS (reverse proxy) or bind it to `127.0.0.1`; stop publishing `8790` raw to the LAN.
- [ ] Always set a strong, persistent `TELEARR_SECRET_KEY` in `.env` (never rely on the random fallback).
- [ ] Set a long `TELEARR_ADMIN_PASS` (>= 12 chars) on first run; change it from the UI afterward.
- [ ] Treat the *arr API key as a secret — it appears in every feed URL; rotate it (`/api/integrations/arr/regenerate`) if a feed/log was exposed.
- [ ] Only monitor Telegram channels you trust for file *names*, until the filename-sanitization fix lands (arbitrary-write risk on unparsed items).
- [ ] Keep `--workers 1` (scanner state is process-local).
- [ ] Run only via the provided compose file (it enforces the non-root `user:`); a bare `docker run` would run as root.
- [ ] Add `security_opt: [no-new-privileges:true]` and consider a read-only rootfs + explicit writable mounts.
- [ ] Restrict the `/media` bind mount to the library subtree the app actually needs, not a whole drive.
- [ ] Watch container stdout for leaked Plex tokens in error lines until the header-based fix lands.
