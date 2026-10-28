// catalog.js — a movie channel's Catalog in its drawer: one row per film the
// channel offers (GET /api/channels/{id}/catalog), plus "Cal identificar" rows
// for messages waiting in Review. Built server-side from stored data only, so
// opening it sends nothing to Telegram.
//
// The list shows first; Radarr's view of each film (GET …/catalog/status, one
// Radarr movie-list read) then fills in the badges that skeletons hold meanwhile.
import { h, api, toast, fmtBytes } from "./core.js";
import { icon } from "./icons.js";
import { t, tn, msg, fmtDateTime } from "./i18n.js";
import { downloadButton, requestedStatus, failureToast } from "./catalog-download.js";

const catalogUrl = (cid) => `/api/channels/${cid}/catalog`;
const statusUrl = (cid) => `/api/channels/${cid}/catalog/status`;
const scanUrl = (cid) => `/api/channels/${cid}/scan`;
const REVIEW_HASH = "#/review";
const CONNECT_HASH = "#/connect";
const KIND_UNIDENTIFIED = "unidentified";
const STATUS_REQUESTED = "requested", STATUS_DOWNLOADED = "downloaded", STATUS_UPGRADE = "upgrade";
const RADARR_CHECKING = "checking", RADARR_OK = "ok", RADARR_DOWN = "down";

/** The phone-width "‹ Canals" button that closes the drawer. */
export const catalogBack = (close) => h("button", { type: "button", class: "btn ghost drawer-back", "aria-label": t("cat.back_aria"), onClick: close },
  h("span", { html: icon("chevron-left") }), t("cat.back"));

const meta = (row) => h("div", { class: "cat-meta" },
  h("span", { class: "cat-q" }, row.quality),
  h("span", {}, fmtBytes(row.size)),
  h("span", { "aria-hidden": "true" }, "·"),
  h("span", { class: "cat-lang" }, row.language));

// ── posters ──────────────────────────────────────────────────────────
// A film row starts as a coloured placeholder tile with its short title; once
// GET /catalog/posters answers (separately, so the list never waits on art),
// tiles with a poster swap to the image. A missing or broken image keeps the tile.
const postersUrl = (cid) => `/api/channels/${cid}/catalog/posters`;
const TILE_TONES = ["#8a6a3c", "#6b4fa0", "#b8436f", "#2e2a26", "#7a2f4f", "#c0532f", "#6f7d3a", "#4d7a8a", "#3a4630"];
const SHORT_TITLE_MAX = 22;

const tileTone = (tmdbId) => TILE_TONES[Math.abs(Number(tmdbId) || 0) % TILE_TONES.length];
const shortTitle = (title) => {
  const s = String(title || "").toUpperCase();
  return s.length > SHORT_TITLE_MAX ? `${s.slice(0, SHORT_TITLE_MAX - 1)}…` : s;
};

const placeholderTile = (row) => h("div", {
  class: "cat-poster tile", role: "img", "aria-label": t("cat.poster_of", { title: row.title }),
  style: `background:${tileTone(row.tmdb_id)}`, dataset: { tmdb: String(row.tmdb_id), title: row.title },
}, shortTitle(row.title));

function showPoster(tile, url) {
  const img = h("img", { class: "cat-poster", src: url, alt: t("cat.poster_of", { title: tile.dataset.title }),
    loading: "lazy", decoding: "async", width: "44", height: "66" });
  img.addEventListener("load", () => tile.replaceWith(img), { once: true });
}

/** Fill the placeholder tiles under `root` with channel `cid`'s posters; silent on failure. */
async function fillPosters(root, cid) {
  let posters;
  try {
    const r = await fetch(postersUrl(cid), { credentials: "same-origin" });
    if (!r.ok) return;
    ({ posters } = await r.json());
  } catch { return; }
  for (const tile of root.querySelectorAll(".cat-poster.tile[data-tmdb]")) {
    const url = posters?.[tile.dataset.tmdb];
    if (url) showPoster(tile, url);
  }
}

// A film's placeholder tile (filled later by fillPosters); a dashed "?" tile for an unidentified message.
const poster = (row) => row.kind === KIND_UNIDENTIFIED
  ? h("div", { class: "cat-poster unknown", "aria-hidden": "true" }, "?")
  : placeholderTile(row);

const skeleton = (cls) => h("span", { class: `skeleton ${cls}`, "aria-hidden": "true" });
const badge = (cls, ico, label) => h("span", { class: `pill cat-badge ${cls}` }, h("span", { html: icon(ico) }), label);

/** Badges for one film's Radarr status (none when Radarr doesn't have it or is unavailable). */
function statusBadges(s) {
  if (s.status === STATUS_REQUESTED) {
    const requested = badge("cat-requested", "clock", t("cat.requested"));
    // a requested upgrade keeps the Baixada badge of the file Radarr already has
    return s.radarr_quality ? [badge("cat-done", "check", t("cat.downloaded_at", { quality: s.radarr_quality })), requested] : [requested];
  }
  if (s.status === STATUS_DOWNLOADED) return [badge("cat-done", "check", t("cat.downloaded"))];
  if (s.status === STATUS_UPGRADE) {
    return [badge("cat-done", "check", t("cat.downloaded_at", { quality: s.radarr_quality })),
      badge("cat-upgrade", "arrow-up", t("cat.upgrade"))];
  }
  return [];
}

/** The row's action for its status: a requested film shows a disabled "Sol·licitada", others Baixar (see Download). */
const statusAction = (slot, s, available) => (s.status === STATUS_REQUESTED
  ? [h("button", { type: "button", class: "btn cat-requested-btn", disabled: true }, t("cat.requested"))]
  : downloadAction(slot, s, available));

/** Show status `s` in a film row's badge and action slots. */
function showStatus(slot, s, available) {
  slot.badges.replaceChildren(...statusBadges(s));
  slot.action.replaceChildren(...statusAction(slot, s, available));
}

/** A film row plus the slots its Radarr status fills in (skeletons until then). */
function filmRow(row, cid) {
  const badges = h("div", { class: "cat-badges" }, skeleton("cat-skel-badge"));
  const action = h("div", { class: "cat-action" }, skeleton("cat-skel-btn"));
  const li = h("li", { class: "cat-row" }, poster(row),
    h("div", { class: "cat-main" },
      h("div", { class: "cat-title", title: row.title }, row.title, " ", row.year ? h("span", { class: "cat-year" }, String(row.year)) : null),
      meta(row), badges),
    action);
  return { li, slot: { badges, action, cid, tmdbId: row.tmdb_id, title: row.title } };
}

// ── Download (Baixar) ────────────────────────────────────────────────
// Baixar asks Radarr for the film (POST …/catalog/{tmdb_id}/download); once it
// accepts, the row turns Sol·licitada at once. A refusal keeps the row as it was
// and shows a toast with Radarr's reason, a retry and a close button. fetch is
// used directly: core.api() would add its own text-only toast.
const downloadUrl = (cid, tmdbId) => `/api/channels/${cid}/catalog/${tmdbId}/download`;
let downloadToastEl = null;

/** The Baixar button for status `s` ([] when the film needs none). */
function downloadAction(slot, s, available) {
  const b = downloadButton(s, available, slot.title);
  if (!b) return [];
  const aria = msg(b.aria);
  const btn = h("button", {
    type: "button", class: `btn cat-get ${b.kind}`, disabled: b.disabled, "aria-label": aria,
    title: b.kind === "upgrade" ? aria : null, onClick: () => requestDownload(slot, s, btn),
  }, h("span", { html: icon(b.kind === "upgrade" ? "arrow-up" : "downloads") }), msg(b.label));
  return [btn];
}

/** POST the request; resolves to { ok, status, body } (status 0 when the server was never reached). */
async function postDownload(slot) {
  try {
    const r = await fetch(downloadUrl(slot.cid, slot.tmdbId), { method: "POST", credentials: "same-origin" });
    if (r.status === 401) { location.href = "/login"; return { ok: false, status: r.status, body: null }; }
    return { ok: r.ok, status: r.status, body: await r.json().catch(() => null) };
  } catch {
    return { ok: false, status: 0, body: null };
  }
}

async function requestDownload(slot, s, btn) {
  btn.disabled = true;
  dismissDownloadToast();
  const answer = await postDownload(slot);
  if (answer.ok) { showStatus(slot, requestedStatus(s), true); return; }
  btn.disabled = false;
  showDownloadToast(failureToast(slot.title, answer), () => requestDownload(slot, s, btn));
}

function dismissDownloadToast() {
  if (downloadToastEl) downloadToastEl.remove();
  downloadToastEl = null;
}

/** The error toast: the film, Radarr's reason, "Torna-ho a provar" and a close button. Stays until closed. */
function showDownloadToast(m, retry) {
  dismissDownloadToast();
  const reason = msg(m.reason).replace(/[.\s]+$/, "");
  downloadToastEl = h("div", { class: "cat-toast", role: "alert" },
    h("span", { class: "cat-toast-ico", "aria-hidden": "true" }, "!"),
    h("div", { class: "cat-toast-txt" },
      h("strong", {}, msg(m.title)),
      h("span", {}, t("cat.nothing_added", { reason })),
      h("button", { type: "button", class: "cat-toast-retry", onClick: () => { dismissDownloadToast(); retry(); } }, t("cat.retry"))),
    h("button", { type: "button", class: "cat-toast-close", "aria-label": t("cat.dismiss"), html: icon("x"), onClick: dismissDownloadToast }));
  document.body.append(downloadToastEl);
}

function unidentifiedRow(row) {
  return h("li", { class: "cat-row unidentified" }, poster(row),
    h("div", { class: "cat-main" },
      h("div", { class: "cat-title mono", title: row.title }, row.title),
      meta(row),
      h("div", { class: "cat-badges" }, h("span", { class: "pill cat-needs" }, t("cat.needs_id")))),
    h("a", { class: "cat-review", href: REVIEW_HASH, "aria-label": t("cat.review_aria", { file: row.title }) },
      t("cat.review"), h("span", { html: icon("chevron-right") })));
}

const lastScan = (c) => c.last_scanned_at
  ? t("cat.last_scan", { when: fmtDateTime(new Date(c.last_scanned_at * 1000)) })
  : t("cat.never_scanned");

async function scanNow(c) {
  const r = await api(scanUrl(c.id), { method: "POST" });
  if (r) toast(r.message ? msg(r.message) : t("cat.scan_now"), "ok");
}

function emptyState(c) {
  return h("div", { class: "cat-empty" },
    h("div", { class: "cat-empty-ico", html: icon("film") }),
    h("h4", {}, t("cat.empty_title")),
    h("p", { class: "muted" }, t("cat.empty_body")),
    h("span", { class: "cat-last-scan" }, lastScan(c)),
    h("button", { type: "button", class: "btn cat-scan", onClick: () => scanNow(c) }, h("span", { html: icon("refresh") }), t("cat.scan_now")));
}

/** Renders the list; returns the status slots of its film rows by TMDB id. */
function render(body, count, c, catalog) {
  if (!catalog) { body.replaceChildren(h("div", { class: "muted small pad" }, t("cat.load_failed"))); return new Map(); }
  count.textContent = tn("cat.films", catalog.count);
  const built = catalog.rows.map((r) => (r.kind === KIND_UNIDENTIFIED ? { li: unidentifiedRow(r) } : { ...filmRow(r, c.id), tmdbId: r.tmdb_id }));
  body.replaceChildren(built.length ? h("ul", { class: "cat-list" }, ...built.map((b) => b.li)) : emptyState(c));
  if (catalog.rows.some((r) => r.kind !== KIND_UNIDENTIFIED)) fillPosters(body, c.id);
  return new Map(built.filter((b) => b.slot).map((b) => [b.tmdbId, b.slot]));
}

const RADARR_LABELS = { [RADARR_CHECKING]: "cat.radarr_checking", [RADARR_OK]: "cat.radarr_ok", [RADARR_DOWN]: "cat.radarr_down" };

/** The header's Radarr indicator: a spinner while checking, then a green or red dot. */
function setRadarr(el, state) {
  const mark = state === RADARR_CHECKING
    ? h("span", { class: "cat-spin", html: icon("loader") })
    : h("span", { class: `dot ${state === RADARR_OK ? "ok" : "bad"}`, "aria-hidden": "true" });
  el.replaceChildren(mark, t(RADARR_LABELS[state]));
}

const offlineNotice = () => h("div", { class: "cat-offline", role: "status" },
  h("span", { class: "cat-offline-ico", html: icon("wifi-off") }),
  h("div", { class: "cat-offline-txt" },
    h("strong", {}, t("cat.offline_title")),
    h("span", {}, t("cat.offline_body")),
    h("a", { class: "cat-connect", href: CONNECT_HASH }, t("cat.open_connect"), h("span", { html: icon("chevron-right") }))));

/** Fills the rows' badges and actions from the status response (null = request failed). */
function applyStatus(slots, radarr, notice, status) {
  const available = Boolean(status && status.radarr && status.radarr.available);
  setRadarr(radarr, available ? RADARR_OK : RADARR_DOWN);
  notice.replaceChildren(...(available ? [] : [offlineNotice()]));
  const byTmdb = new Map((available ? status.rows : []).map((s) => [s.tmdb_id, s]));
  for (const [tmdbId, slot] of slots) showStatus(slot, byTmdb.get(tmdbId) || {}, available);
}

/** The drawer's Catalog section for movie channel `c`; fills itself once loaded. */
export function catalogSection(c) {
  const headingId = `cat-h-${c.id}`;
  const count = h("span", { class: "cat-count muted small" });
  const radarr = h("span", { class: "cat-radarr", "aria-live": "polite" });
  const notice = h("div", { class: "cat-notice" });
  const body = h("div", { class: "cat-body" }, h("div", { class: "muted small pad" }, t("common.loading")));
  setRadarr(radarr, RADARR_CHECKING);
  const status = api(statusUrl(c.id));       // in parallel with the list; applied once rows exist
  api(catalogUrl(c.id))
    .then((catalog) => render(body, count, c, catalog))
    .then((slots) => status.then((s) => applyStatus(slots, radarr, notice, s)));
  return h("section", { class: "drawer-eps catalog", "aria-labelledby": headingId },
    h("div", { class: "cat-head" }, h("div", { class: "cat-head-title" }, h("h3", { id: headingId }, t("cat.title")), count), radarr),
    notice,
    body);
}
