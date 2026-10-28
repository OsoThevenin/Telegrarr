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

// Placeholder tile until posters land; a dashed "?" tile for an unidentified message.
const poster = (row) => row.kind === KIND_UNIDENTIFIED
  ? h("div", { class: "cat-poster unknown", "aria-hidden": "true" }, "?")
  : h("div", { class: "cat-poster", role: "img", "aria-label": t("cat.poster_of", { title: row.title }), html: icon("film") });

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
