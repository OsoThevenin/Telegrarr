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
import { FILTER_ALL, chipStates, footerState, pageUrl } from "./catalog-filters.js";

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

/** Channel `cid`'s posters by TMDB id ({} on failure, so tiles stay). */
async function loadPosters(cid) {
  try {
    const r = await fetch(postersUrl(cid), { credentials: "same-origin" });
    if (!r.ok) return {};
    return (await r.json()).posters || {};
  } catch { return {}; }
}

/** Fill the placeholder tiles under `root` from `postersP` (the posters loaded once per drawer). */
async function fillPosters(root, postersP) {
  const posters = await postersP;
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

/** The list rows; returns the `<li>`s and the status slots of the film rows by TMDB id. */
function buildRows(rows) {
  const built = rows.map((r) => (r.kind === KIND_UNIDENTIFIED ? { li: unidentifiedRow(r) } : { ...filmRow(r), row: r }));
  return { items: built.map((b) => b.li), slots: built.filter((b) => b.slot).map((b) => [b.row, b.slot]) };
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

/** Fills slots ([row, slot] pairs) with their status: a filtered page's own, else the status response's. */
function applyStatuses(slots, statuses) {
  for (const [row, slot] of slots) {
    const s = row.status ? row : statuses.get(row.tmdb_id) || {};
    slot.badges.replaceChildren(...statusBadges(s));
    slot.action.replaceChildren(...statusAction(s));
  }
}

// ── toolbar: search field and filter chips ───────────────────────────
const SEARCH_DELAY_MS = 250;

/** The search field; calls `onSearch(text)` once typing pauses. */
function searchField(onSearch) {
  let timer = 0;
  const input = h("input", { type: "search", class: "cat-search-input", "aria-label": t("cat.search_label"), autocomplete: "off" });
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => onSearch(input.value), SEARCH_DELAY_MS);
  });
  const el = h("label", { class: "cat-search" }, h("span", { class: "cat-search-ico", html: icon("search") }), input);
  return { el, input };
}

/** Re-renders the filter chips into `group` for the current counts and Radarr state. */
function renderChips(group, counts, available, pressed, onPick) {
  group.replaceChildren(...chipStates(counts, available, pressed).map((chip) =>
    h("button", { type: "button", class: "cat-chip", "aria-pressed": String(chip.pressed), disabled: chip.disabled,
      onClick: () => onPick(chip.id) },
    t(chip.label), h("span", { class: "cat-chip-n" }, chip.count))));
}

function toolbar(onSearch) {
  const search = searchField(onSearch);
  const chips = h("div", { class: "cat-chips", role: "group", "aria-label": t("cat.filter_aria") });
  return { el: h("div", { class: "cat-toolbar" }, search.el, chips), input: search.input, chips };
}

// ── footer and no-match states ────────────────────────────────────────
/** "Mostrant X de Y" (or "N resultats" while searching) with "Carrega'n més" while pages remain. */
function footer(page, onMore) {
  const state = footerState(page);
  const more = state.more
    ? h("button", { type: "button", class: "btn cat-more", onClick: (e) => { e.currentTarget.disabled = true; onMore(); } }, t("cat.load_more"))
    : null;
  const text = state.n == null ? t(state.key, state.params) : tn(state.key, state.n);
  return h("div", { class: "cat-footer" }, h("span", { class: "muted small", "aria-live": "polite" }, text), more);
}

const noResults = (q, onClear) => h("div", { class: "cat-no-results" },
  h("strong", {}, t("cat.no_results", { q })),
  h("span", { class: "muted" }, t("cat.no_results_hint")),
  h("button", { type: "button", class: "btn cat-clear", onClick: onClear }, t("cat.clear_search")));

const filterEmpty = () => h("div", { class: "cat-no-results" }, h("span", { class: "muted" }, t("cat.filter_empty")));

/** The drawer's Catalog section for movie channel `c`; fills itself once loaded. */
export function catalogSection(c) {
  const headingId = `cat-h-${c.id}`;
  const count = h("span", { class: "cat-count muted small" });
  const radarr = h("span", { class: "cat-radarr", "aria-live": "polite" });
  const notice = h("div", { class: "cat-notice" });
  const body = h("div", { class: "cat-body" }, h("div", { class: "muted small pad" }, t("common.loading")));
  const bar = toolbar((q) => load({ q }));
  bar.el.hidden = true;
  const postersP = loadPosters(c.id);
  // What is on screen; replaced (never mutated) on every load and status answer.
  // `all` comes with every page; `statusCounts` from Radarr (status response or a filtered page).
  let view = { q: "", filter: FILTER_ALL, rows: [], page: null, slots: [], all: 0, statusCounts: null,
    available: null, statuses: new Map() };
  let loadSeq = 0;

  const showChips = () => renderChips(bar.chips, { ...view.statusCounts, all: view.all }, view.available, view.filter,
    (filter) => load({ filter }));

  function showList() {
    const { page, rows, all } = view;
    count.textContent = tn("cat.films", all);
    bar.input.placeholder = tn("cat.search_placeholder", all);
    bar.el.hidden = all === 0;
    if (all === 0) { body.replaceChildren(emptyState(c)); return; }
    if (!rows.length) { body.replaceChildren(view.q ? noResults(view.q, clearSearch) : filterEmpty()); return; }
    const built = buildRows(rows);
    view = { ...view, slots: built.slots };
    const more = () => load({ offset: page.next_offset });
    body.replaceChildren(h("ul", { class: "cat-list" }, ...built.items),
      footer({ loaded: rows.length, count: page.count, searching: Boolean(view.q), next_offset: page.next_offset }, more));
    if (view.available !== null) applyStatuses(built.slots, view.statuses);
    if (rows.some((r) => r.kind !== KIND_UNIDENTIFIED)) fillPosters(body, postersP);
  }

  /** Loads the page for `change` (q / filter → from the top; offset → append the next page). */
  async function load(change) {
    const next = { q: view.q, filter: view.filter, offset: 0, ...change };
    const seq = ++loadSeq;
    const page = await api(pageUrl(c.id, next));
    if (seq !== loadSeq) return;                         // a newer search or filter won
    if (!page) {                                         // api() already toasted the error
      if (view.page) showList();                         // keep what was shown; re-enables "Carrega'n més"
      else body.replaceChildren(h("div", { class: "muted small pad" }, t("cat.load_failed")));
      showChips();
      return;
    }
    const rows = next.offset ? [...view.rows, ...page.rows] : page.rows;
    const statusCounts = page.counts.missing == null ? view.statusCounts : page.counts;
    view = { ...view, q: next.q, filter: next.filter, page, rows, all: page.counts.all, statusCounts };
    showChips();
    showList();
  }

  function clearSearch() {
    bar.input.value = "";
    load({ q: "" });
  }

  setRadarr(radarr, RADARR_CHECKING);
  const status = api(statusUrl(c.id));       // in parallel with the list; applied once rows exist
  load({}).then(() => status).then((s) => {
    const available = Boolean(s && s.radarr && s.radarr.available);
    setRadarr(radarr, available ? RADARR_OK : RADARR_DOWN);
    notice.replaceChildren(...(available ? [] : [offlineNotice()]));
    const statuses = new Map((available ? s.rows : []).map((row) => [row.tmdb_id, row]));
    view = { ...view, available, statuses, statusCounts: available ? s.counts : null };
    showChips();
    applyStatuses(view.slots, statuses);
  });
  return h("section", { class: "drawer-eps catalog", "aria-labelledby": headingId },
    h("div", { class: "cat-head" }, h("div", { class: "cat-head-title" }, h("h3", { id: headingId }, t("cat.title")), count), radarr),
    notice,
    bar.el,
    body);
}
