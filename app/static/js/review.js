// review.js — Pending review: movie channel messages without a confident TMDB
// match. Each one is either assigned a film (TMDB search pick, or a typed TMDB /
// IMDb id), which offers it to Radarr, or discarded for good.
import { h, api, jpost, toast, fmtBytes } from "./core.js";
import { icon } from "./icons.js";
import { t } from "./i18n.js";

const SEARCH_DEBOUNCE_MS = 350;
const MIN_QUERY_LEN = 2;

const card = (...body) => h("section", { class: "card" }, ...body);

/** "tt1234567" / "1234567" with a tt prefix → IMDb id; plain digits → TMDB id. */
function typedId(text) {
  const raw = text.trim();
  if (/^tt\d+$/i.test(raw)) return { imdb_id: raw.toLowerCase() };
  if (/^\d+$/.test(raw)) return { tmdb_id: Number(raw) };
  return null;
}

function parsedLine(entry) {
  const parsed = [entry.parsed_title, entry.year && `(${entry.year})`].filter(Boolean).join(" ");
  return [entry.channel_title, parsed && t("review.read_as", { parsed }), entry.size && fmtBytes(entry.size)].filter(Boolean).join(" · ");
}

function entryCard(entry, reload) {
  const url = `/api/review/${entry.channel_id}/${entry.message_id}`;
  let timer = null;
  const results = h("div", { class: "imdb-results" });
  const query = h("input", { placeholder: t("review.search_placeholder"), autocomplete: "off", value: entry.parsed_title || "" });
  const idInp = h("input", { placeholder: t("review.id_placeholder"), autocomplete: "off" });

  const assign = async (ids) => {
    const r = await jpost(`${url}/assign`, ids);
    if (r) { toast(t("review.offered", { title: r.title }), "ok"); reload(); }
  };
  const discard = async () => {
    const r = await jpost(`${url}/discard`, {});
    if (r) { toast(t("review.discarded"), "ok"); reload(); }
  };
  const search = async (q) => {
    if (!q || q.length < MIN_QUERY_LEN) return results.replaceChildren();
    const res = await api(`/api/tmdb/movies?q=${encodeURIComponent(q)}`); if (!res) return;
    if (!res.length) return results.replaceChildren(h("div", { class: "muted small pad" }, t("review.no_films")));
    results.replaceChildren(...res.map((f) => h("button", { type: "button", class: "hit", onClick: () => assign({ tmdb_id: f.tmdb_id }) },
      f.title, h("small", {}, ` ${f.year ? `(${f.year})` : ""}${f.original_title && f.original_title !== f.title ? ` · ${f.original_title}` : ""}`))));
  };
  query.addEventListener("input", () => { clearTimeout(timer); const q = query.value; timer = setTimeout(() => search(q), SEARCH_DEBOUNCE_MS); });
  const assignTyped = () => {
    const ids = typedId(idInp.value);
    if (!ids) return toast(t("review.bad_id"), "err");
    assign(ids);
  };

  return card(
    h("div", { class: "card-h" }, entry.file_name || t("review.message", { id: entry.message_id })),
    h("div", { class: "muted small" }, parsedLine(entry)),
    entry.caption ? h("div", { class: "small", style: "margin:8px 0;white-space:pre-line" }, entry.caption) : null,
    h("div", { class: "small", style: "color:var(--warn);margin-bottom:10px" }, t(entry.reason)),
    h("label", {}, t("review.film"), query), results,
    h("div", { class: "set-actions" }, idInp,
      h("button", { class: "btn primary sm", onClick: assignTyped }, t("review.assign")),
      h("button", { class: "btn ghost sm", onClick: discard }, h("span", { html: icon("trash") }), t("review.discard"))));
}

function emptyState() {
  return h("div", { class: "empty-state" },
    h("div", { class: "empty-ico", html: icon("film") }),
    h("div", { class: "empty-title" }, t("review.empty_title")),
    h("div", { class: "muted small" }, t("review.empty_body")));
}

export function viewReview() {
  const root = h("div", { class: "stack settings-wrap" }, h("div", { class: "empty" }, t("common.loading")));
  const load = async () => {
    const entries = await api("/api/review"); if (!entries) return;
    root.replaceChildren(...(entries.length ? entries.map((e) => entryCard(e, load)) : [emptyState()]));
  };
  load();
  return root;
}
