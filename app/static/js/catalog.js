// catalog.js — a movie channel's Catalog in its drawer: one row per film the
// channel offers (GET /api/channels/{id}/catalog), plus "Cal identificar" rows
// for messages waiting in Review. Built server-side from stored data only, so
// opening it sends nothing to Telegram.
import { h, api, toast, fmtBytes } from "./core.js";
import { icon } from "./icons.js";
import { t, tn, msg, fmtDateTime } from "./i18n.js";

const catalogUrl = (cid) => `/api/channels/${cid}/catalog`;
const scanUrl = (cid) => `/api/channels/${cid}/scan`;
const REVIEW_HASH = "#/review";
const KIND_UNIDENTIFIED = "unidentified";

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

function filmRow(row) {
  return h("li", { class: "cat-row" }, poster(row),
    h("div", { class: "cat-main" },
      h("div", { class: "cat-title", title: row.title }, row.title, " ", row.year ? h("span", { class: "cat-year" }, String(row.year)) : null),
      meta(row)));
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

function render(body, count, c, catalog) {
  if (!catalog) { body.replaceChildren(h("div", { class: "muted small pad" }, t("cat.load_failed"))); return; }
  count.textContent = tn("cat.films", catalog.count);
  body.replaceChildren(catalog.rows.length
    ? h("ul", { class: "cat-list" }, ...catalog.rows.map((r) => (r.kind === KIND_UNIDENTIFIED ? unidentifiedRow(r) : filmRow(r))))
    : emptyState(c));
  if (catalog.rows.some((r) => r.kind !== KIND_UNIDENTIFIED)) fillPosters(body, c.id);
}

/** The drawer's Catalog section for movie channel `c`; fills itself once loaded. */
export function catalogSection(c) {
  const headingId = `cat-h-${c.id}`;
  const count = h("span", { class: "cat-count muted small" });
  const body = h("div", { class: "cat-body" }, h("div", { class: "muted small pad" }, t("common.loading")));
  api(catalogUrl(c.id)).then((catalog) => render(body, count, c, catalog));
  return h("section", { class: "drawer-eps catalog", "aria-labelledby": headingId },
    h("div", { class: "cat-head" }, h("h3", { id: headingId }, t("cat.title")), count),
    body);
}
