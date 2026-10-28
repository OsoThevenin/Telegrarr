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

// Placeholder tile until posters land; a dashed "?" tile for an unidentified message.
const poster = (row) => row.kind === KIND_UNIDENTIFIED
  ? h("div", { class: "cat-poster unknown", "aria-hidden": "true" }, "?")
  : h("div", { class: "cat-poster", role: "img", "aria-label": t("cat.poster_of", { title: row.title }), html: icon("film") });

const skeleton = (cls) => h("span", { class: `skeleton ${cls}`, "aria-hidden": "true" });
const badge = (cls, ico, label) => h("span", { class: `pill cat-badge ${cls}` }, h("span", { html: icon(ico) }), label);

/** Badges for one film's Radarr status (none when Radarr doesn't have it or is unavailable). */
function statusBadges(s) {
  if (s.status === STATUS_REQUESTED) return [badge("cat-requested", "clock", t("cat.requested"))];
  if (s.status === STATUS_DOWNLOADED) return [badge("cat-done", "check", t("cat.downloaded"))];
  if (s.status === STATUS_UPGRADE) {
    return [badge("cat-done", "check", t("cat.downloaded_at", { quality: s.radarr_quality })),
      badge("cat-upgrade", "arrow-up", t("cat.upgrade"))];
  }
  return [];
}

/** The row's action for its status: a requested film shows a disabled "Sol·licitada". */
const statusAction = (s) => (s.status === STATUS_REQUESTED
  ? [h("button", { type: "button", class: "btn cat-requested-btn", disabled: true }, t("cat.requested"))]
  : []);

/** A film row plus the slots its Radarr status fills in (skeletons until then). */
function filmRow(row) {
  const badges = h("div", { class: "cat-badges" }, skeleton("cat-skel-badge"));
  const action = h("div", { class: "cat-action" }, skeleton("cat-skel-btn"));
  const li = h("li", { class: "cat-row" }, poster(row),
    h("div", { class: "cat-main" },
      h("div", { class: "cat-title", title: row.title }, row.title, " ", row.year ? h("span", { class: "cat-year" }, String(row.year)) : null),
      meta(row), badges),
    action);
  return { li, slot: { badges, action } };
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
  const built = catalog.rows.map((r) => (r.kind === KIND_UNIDENTIFIED ? { li: unidentifiedRow(r) } : { ...filmRow(r), tmdbId: r.tmdb_id }));
  body.replaceChildren(built.length ? h("ul", { class: "cat-list" }, ...built.map((b) => b.li)) : emptyState(c));
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
  for (const [tmdbId, slot] of slots) {
    const s = byTmdb.get(tmdbId) || {};
    slot.badges.replaceChildren(...statusBadges(s));
    slot.action.replaceChildren(...statusAction(s));
  }
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
