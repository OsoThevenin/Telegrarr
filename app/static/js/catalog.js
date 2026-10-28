// catalog.js — a movie channel's Catalog in its drawer: one row per film the
// channel offers (GET /api/channels/{id}/catalog), plus "Cal identificar" rows
// for messages waiting in Review. Built server-side from stored data only, so
// opening it sends nothing to Telegram.
//
// The list shows first; Radarr's view of each film (GET …/catalog/status, the one
// Radarr movie-list read of a drawer opening) then fills in the badges that
// skeletons hold meanwhile, and brings Radarr's posters.
import { h, api, toast, fmtBytes } from "./core.js";
import { icon } from "./icons.js";
import { t, tn, msg, fmtDateTime } from "./i18n.js";
import { FILTER_ALL, chipStates, footerState, pageUrl } from "./catalog-filters.js";
import {
  STATUS_REQUESTED, STATUS_DOWNLOADED, STATUS_UPGRADE,
  downloadButton, requestedStatus, failureToast,
} from "./catalog-download.js";

const statusUrl = (cid) => `/api/channels/${cid}/catalog/status`;
const scanUrl = (cid) => `/api/channels/${cid}/scan`;
const REVIEW_HASH = "#/review";
const CONNECT_HASH = "#/connect";
const KIND_UNIDENTIFIED = "unidentified";
const RADARR_CHECKING = "checking", RADARR_OK = "ok", RADARR_DOWN = "down";

/** The phone-width "‹ Canals" button that closes the drawer. */
export const catalogBack = (close) => h("button", {
  type: "button", class: "btn ghost drawer-back", "aria-label": t("cat.back_aria"), onClick: close,
}, h("span", { html: icon("chevron-left") }), t("cat.back"));

/** Call when the drawer closes: removes what the Catalog left outside it (the error toast). */
export const catalogClosed = () => dismissDownloadToast();

const meta = (row) => h("div", { class: "cat-meta" },
  h("span", { class: "cat-q" }, row.quality),
  h("span", {}, fmtBytes(row.size)),
  h("span", { "aria-hidden": "true" }, "·"),
  h("span", { class: "cat-lang" }, row.language));

// ── posters ──────────────────────────────────────────────────────────
// A film row starts as a coloured placeholder tile with its short title. Radarr's
// posters come with the status; once it answered, the shown tiles still without one
// ask GET /catalog/posters (TMDB only) for theirs. A missing or broken image keeps the tile.
const postersUrl = (cid) => `/api/channels/${cid}/catalog/posters`;
const TILE_TONES = 9;            // .cat-poster.tile.tone-0 … tone-8 in app.css
const SHORT_TITLE_MAX = 22;

const tileTone = (tmdbId) => `tone-${Math.abs(Number(tmdbId) || 0) % TILE_TONES}`;
const shortTitle = (title) => {
  const s = String(title || "").toUpperCase();
  return s.length > SHORT_TITLE_MAX ? `${s.slice(0, SHORT_TITLE_MAX - 1)}…` : s;
};

const placeholderTile = (row) => h("div", {
  class: `cat-poster tile ${tileTone(row.tmdb_id)}`, role: "img",
  "aria-label": t("cat.poster_of", { title: row.title }),
  dataset: { tmdb: String(row.tmdb_id), title: row.title },
}, shortTitle(row.title));

function showPoster(tile, url) {
  const img = h("img", {
    class: "cat-poster", src: url, alt: t("cat.poster_of", { title: tile.dataset.title }),
    loading: "lazy", decoding: "async", width: "44", height: "66",
  });
  img.addEventListener("load", () => tile.replaceWith(img), { once: true });
}

/** TMDB posters of films `ids` of channel `cid` ({} on failure, so tiles stay). */
async function loadPosters(cid, ids) {
  const query = new URLSearchParams(ids.map((id) => ["ids", id]));
  try {
    const r = await fetch(`${postersUrl(cid)}?${query}`, { credentials: "same-origin" });
    if (!r.ok) return {};
    return (await r.json()).posters || {};
  } catch { return {}; }
}

/** The posters one drawer knows by TMDB id (URL or null), each film asked for at most once. */
function posterStore(cid) {
  let known = {};                          // replaced, never mutated
  const addRadarr = (rows) => {
    const radarr = rows.filter((r) => r.poster).map((r) => [r.tmdb_id, r.poster]);
    known = { ...known, ...Object.fromEntries(radarr) };
  };
  /** Fills the tiles under `root` once `ready` (the status) settled. */
  async function fill(root, ready) {
    await ready;
    const tiles = [...root.querySelectorAll(".cat-poster.tile[data-tmdb]")];
    const ids = [...new Set(tiles.map((tile) => tile.dataset.tmdb))];
    const unknown = ids.filter((id) => !(id in known));
    if (unknown.length) known = { ...known, ...(await loadPosters(cid, unknown)) };
    for (const tile of tiles) {
      const url = known[tile.dataset.tmdb];
      if (url) showPoster(tile, url);
    }
  }
  return { addRadarr, fill };
}

// A film's placeholder tile (filled later); a dashed "?" tile for an unidentified message.
const poster = (row) => row.kind === KIND_UNIDENTIFIED
  ? h("div", { class: "cat-poster unknown", "aria-hidden": "true" }, "?")
  : placeholderTile(row);

// ── status badges and the row's action ───────────────────────────────
const skeleton = (cls) => h("span", { class: `skeleton ${cls}`, "aria-hidden": "true" });
const badge = (cls, ico, label) => h("span", { class: `pill cat-badge ${cls}` },
  h("span", { html: icon(ico) }), label);

/** "Baixada", or "Baixada · 720p" when a better file is available or requested. */
const doneBadge = (s) => badge("cat-done", "check", s.status === STATUS_DOWNLOADED
  ? t("cat.downloaded") : t("cat.downloaded_at", { quality: s.radarr_quality }));
const EXTRA_BADGES = {
  [STATUS_REQUESTED]: () => badge("cat-requested", "clock", t("cat.requested")),
  [STATUS_UPGRADE]: () => badge("cat-upgrade", "arrow-up", t("cat.upgrade")),
};

/** Badges for one film's Radarr status: Baixada whenever Radarr holds a file, plus
 *  Sol·licitada or Millora qualitat (none when Radarr lacks it or is unavailable). */
function statusBadges(s) {
  const done = s.radarr_quality ? [doneBadge(s)] : [];
  const extra = EXTRA_BADGES[s.status];
  return extra ? [...done, extra()] : done;
}

/** The row's action: a requested film shows a disabled "Sol·licitada", others Baixar. */
const statusAction = (slot, s, available) => (s.status === STATUS_REQUESTED
  ? [h("button", { type: "button", class: "btn cat-requested-btn", disabled: true },
    t("cat.requested"))]
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
  const year = row.year ? h("span", { class: "cat-year" }, String(row.year)) : null;
  const li = h("li", { class: "cat-row" }, poster(row),
    h("div", { class: "cat-main" },
      h("div", { class: "cat-title", title: row.title }, row.title, " ", year),
      meta(row), badges),
    action);
  return { li, slot: { badges, action, cid, tmdbId: row.tmdb_id, title: row.title } };
}

// ── Download (Baixar) ────────────────────────────────────────────────
// Baixar asks Radarr for the film (POST …/catalog/{tmdb_id}/download); once it
// accepts, the row turns Sol·licitada at once. A refusal keeps the row as it was
// and shows a toast with Radarr's reason, a retry and a close button. fetch is
// used directly: core.api() would add its own text-only toast.
const REQUESTED_EVENT = "catalog:requested";
const downloadUrl = (cid, tmdbId) => `/api/channels/${cid}/catalog/${tmdbId}/download`;
let downloadToastEl = null;

/** The Baixar button for status `s` ([] when the film needs none). */
function downloadAction(slot, s, available) {
  const b = downloadButton(s, available, slot.title);
  if (!b) return [];
  const aria = msg(b.aria);
  const upgrade = b.kind === "upgrade";
  const btn = h("button", {
    type: "button", class: `btn cat-get ${b.kind}`, disabled: b.disabled, "aria-label": aria,
    title: upgrade ? aria : null, onClick: () => requestDownload(slot, s, btn),
  }, h("span", { html: icon(upgrade ? "arrow-up" : "downloads") }), msg(b.label));
  return [btn];
}

/** POST the request; resolves to { ok, status, body } (status 0: the server was never reached). */
async function postDownload(slot) {
  const failed = (status) => ({ ok: false, status, body: null });
  try {
    const url = downloadUrl(slot.cid, slot.tmdbId);
    const r = await fetch(url, { method: "POST", credentials: "same-origin" });
    if (r.status === 401) { location.href = "/login"; return failed(r.status); }
    return { ok: r.ok, status: r.status, body: await r.json().catch(() => null) };
  } catch {
    return failed(0);
  }
}

async function requestDownload(slot, s, btn) {
  btn.disabled = true;
  dismissDownloadToast();
  const answer = await postDownload(slot);
  if (answer.ok) {
    showStatus(slot, requestedStatus(s), true);
    // the chips recount
    slot.action.dispatchEvent(new CustomEvent(REQUESTED_EVENT, { bubbles: true }));
    return;
  }
  btn.disabled = false;
  showDownloadToast(failureToast(slot.title, answer), () => requestDownload(slot, s, btn));
}

function dismissDownloadToast() {
  if (downloadToastEl) downloadToastEl.remove();
  downloadToastEl = null;
}

/** The error toast: the film, Radarr's reason, "Torna-ho a provar" and a close button.
 *  Stays until closed, retried, or the drawer closes. */
function showDownloadToast(m, retry) {
  dismissDownloadToast();
  const reason = msg(m.reason).replace(/[.\s]+$/, "");
  const again = () => { dismissDownloadToast(); retry(); };
  downloadToastEl = h("div", { class: "cat-toast", role: "alert" },
    h("span", { class: "cat-toast-ico", "aria-hidden": "true" }, "!"),
    h("div", { class: "cat-toast-txt" },
      h("strong", {}, msg(m.title)),
      h("span", {}, t("cat.nothing_added", { reason })),
      h("button", { type: "button", class: "cat-toast-retry", onClick: again }, t("cat.retry"))),
    h("button", { type: "button", class: "cat-toast-close", "aria-label": t("cat.dismiss"),
      html: icon("x"), onClick: dismissDownloadToast }));
  document.body.append(downloadToastEl);
}

function unidentifiedRow(row) {
  return h("li", { class: "cat-row unidentified" }, poster(row),
    h("div", { class: "cat-main" },
      h("div", { class: "cat-title mono", title: row.title }, row.title),
      meta(row),
      h("div", { class: "cat-badges" }, h("span", { class: "pill cat-needs" }, t("cat.needs_id")))),
    h("a", { class: "cat-review", href: REVIEW_HASH,
      "aria-label": t("cat.review_aria", { file: row.title }) },
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
    h("button", { type: "button", class: "btn cat-scan", onClick: () => scanNow(c) },
      h("span", { html: icon("refresh") }), t("cat.scan_now")));
}

/** The list rows of channel `cid`: the `<li>`s and [row, status slot] pairs of the films. */
function buildRows(rows, cid) {
  const built = rows.map((r) => (r.kind === KIND_UNIDENTIFIED
    ? { li: unidentifiedRow(r) } : { ...filmRow(r, cid), row: r }));
  return { items: built.map((b) => b.li),
    slots: built.filter((b) => b.slot).map((b) => [b.row, b.slot]) };
}

const RADARR_LABELS = {
  [RADARR_CHECKING]: "cat.radarr_checking",
  [RADARR_OK]: "cat.radarr_ok",
  [RADARR_DOWN]: "cat.radarr_down",
};

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
    h("a", { class: "cat-connect", href: CONNECT_HASH }, t("cat.open_connect"),
      h("span", { html: icon("chevron-right") }))));

/** Fills slots ([row, slot] pairs): the status response's status, else a filtered page's own. */
function applyStatuses(slots, statuses, available) {
  for (const [row, slot] of slots) {
    showStatus(slot, statuses.get(row.tmdb_id) || (row.status ? row : {}), available);
  }
}

// ── toolbar: search field and filter chips ───────────────────────────
const SEARCH_DELAY_MS = 250;

/** The search field; calls `onSearch(text)` once typing pauses. */
function searchField(onSearch) {
  let timer = 0;
  const input = h("input", { type: "search", class: "cat-search-input",
    "aria-label": t("cat.search_label"), autocomplete: "off" });
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => onSearch(input.value), SEARCH_DELAY_MS);
  });
  const el = h("label", { class: "cat-search" },
    h("span", { class: "cat-search-ico", html: icon("search") }), input);
  return { el, input };
}

/** Re-renders the filter chips into `group` for the current counts and Radarr state. */
function renderChips(group, counts, available, pressed, onPick) {
  group.replaceChildren(...chipStates(counts, available, pressed).map((chip) =>
    h("button", { type: "button", class: "cat-chip", "aria-pressed": String(chip.pressed),
      disabled: chip.disabled, onClick: () => onPick(chip.id) },
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
    ? h("button", { type: "button", class: "btn cat-more",
      onClick: (e) => { e.currentTarget.disabled = true; onMore(); } }, t("cat.load_more"))
    : null;
  const text = state.n == null ? t(state.key, state.params) : tn(state.key, state.n);
  return h("div", { class: "cat-footer" },
    h("span", { class: "muted small", "aria-live": "polite" }, text), more);
}

const noResults = (q, onClear) => h("div", { class: "cat-no-results" },
  h("strong", {}, t("cat.no_results", { q })),
  h("span", { class: "muted" }, t("cat.no_results_hint")),
  h("button", { type: "button", class: "btn cat-clear", onClick: onClear }, t("cat.clear_search")));

const filterEmpty = () => h("div", { class: "cat-no-results" },
  h("span", { class: "muted" }, t("cat.filter_empty")));

// ── the section and its state ────────────────────────────────────────
// One drawer's Catalog: its elements, and `view` (what is on screen), which is
// replaced (never mutated) on every load and status answer. `view.all` comes with
// every page; `statusCounts` from Radarr (the status response or a filtered page).
const note = (text) => h("div", { class: "muted small pad" }, text);

function newCatalog(c) {
  const ctl = {
    c, seq: 0, statusShown: null, posters: posterStore(c.id),
    view: { q: "", filter: FILTER_ALL, rows: [], page: null, slots: [], all: 0,
      statusCounts: null, available: null, statuses: new Map() },
  };
  ctl.parts = {
    count: h("span", { class: "cat-count muted small" }),
    radarr: h("span", { class: "cat-radarr", "aria-live": "polite" }),
    notice: h("div", { class: "cat-notice" }),
    body: h("div", { class: "cat-body" }, note(t("common.loading"))),
    bar: toolbar((q) => load(ctl, { q })),
  };
  ctl.parts.bar.el.hidden = true;
  return ctl;
}

function showChips(ctl) {
  const { view } = ctl;
  renderChips(ctl.parts.bar.chips, { ...view.statusCounts, all: view.all }, view.available,
    view.filter, (filter) => load(ctl, { filter }));
}

function pageFooter(ctl) {
  const { page, rows, q } = ctl.view;
  const shown = { loaded: rows.length, count: page.count, searching: Boolean(q),
    next_offset: page.next_offset };
  return footer(shown, () => load(ctl, { offset: page.next_offset }));
}

function showList(ctl) {
  const { view, parts, c } = ctl;
  parts.count.textContent = tn("cat.films", view.all);
  parts.bar.input.placeholder = tn("cat.search_placeholder", view.all);
  parts.bar.el.hidden = view.all === 0;
  if (view.all === 0) { parts.body.replaceChildren(emptyState(c)); return; }
  if (!view.rows.length) {
    parts.body.replaceChildren(view.q ? noResults(view.q, () => clearSearch(ctl)) : filterEmpty());
    return;
  }
  const built = buildRows(view.rows, c.id);
  ctl.view = { ...view, slots: built.slots };
  parts.body.replaceChildren(h("ul", { class: "cat-list" }, ...built.items), pageFooter(ctl));
  if (view.available !== null) applyStatuses(built.slots, view.statuses, view.available);
  const hasFilms = view.rows.some((r) => r.kind !== KIND_UNIDENTIFIED);
  if (hasFilms) ctl.posters.fill(parts.body, ctl.statusShown);
}

/** Loads the page for `change` (q / filter → from the top; offset → append the next page). */
async function load(ctl, change) {
  const next = { q: ctl.view.q, filter: ctl.view.filter, offset: 0, ...change };
  const seq = ++ctl.seq;
  const page = await api(pageUrl(ctl.c.id, next));
  if (seq !== ctl.seq) return;              // a newer search or filter won
  if (!page) {                              // api() already toasted the error
    // keep what was shown (re-enables "Carrega'n més"), else say it failed
    if (ctl.view.page) showList(ctl);
    else ctl.parts.body.replaceChildren(note(t("cat.load_failed")));
    showChips(ctl);
    return;
  }
  const rows = next.offset ? [...ctl.view.rows, ...page.rows] : page.rows;
  const statusCounts = page.counts.missing == null ? ctl.view.statusCounts : page.counts;
  ctl.view = { ...ctl.view, q: next.q, filter: next.filter, page, rows, all: page.counts.all,
    statusCounts };
  showChips(ctl);
  showList(ctl);
}

function clearSearch(ctl) {
  ctl.parts.bar.input.value = "";
  load(ctl, { q: "" });
}

/** Applies a status response (null = request failed): header dot, notice, posters,
 *  chip counts and row badges. */
function applyStatus(ctl, s) {
  const available = Boolean(s && s.radarr && s.radarr.available);
  const rows = available ? s.rows : [];
  setRadarr(ctl.parts.radarr, available ? RADARR_OK : RADARR_DOWN);
  ctl.parts.notice.replaceChildren(...(available ? [] : [offlineNotice()]));
  ctl.posters.addRadarr(rows);
  const statuses = new Map(rows.map((row) => [row.tmdb_id, row]));
  ctl.view = { ...ctl.view, available, statuses, statusCounts: available ? s.counts : null };
  showChips(ctl);
  applyStatuses(ctl.view.slots, statuses, available);
}

/** The drawer's Catalog section for movie channel `c`; fills itself once loaded. */
export function catalogSection(c) {
  const ctl = newCatalog(c);
  const { count, radarr, notice, bar, body } = ctl.parts;
  const headingId = `cat-h-${c.id}`;
  setRadarr(radarr, RADARR_CHECKING);
  const status = api(statusUrl(c.id));       // in parallel with the list; applied once rows exist
  ctl.statusShown = load(ctl, {}).then(() => status).then((s) => applyStatus(ctl, s));
  const title = h("div", { class: "cat-head-title" },
    h("h3", { id: headingId }, t("cat.title")), count);
  const section = h("section", { class: "drawer-eps catalog", "aria-labelledby": headingId },
    h("div", { class: "cat-head" }, title, radarr), notice, bar.el, body);
  // A Download changes the counts: re-read the status (a new action, so a new Radarr read).
  section.addEventListener(REQUESTED_EVENT, () => api(statusUrl(c.id)).then((s) => {
    if (s) applyStatus(ctl, s);
  }));
  return section;
}
