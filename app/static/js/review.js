// review.js — Pending review: movie channel messages without a confident TMDB
// match. Each one is either assigned a film (TMDB search pick, or a typed TMDB /
// IMDb id), which offers it to Radarr, or discarded for good.
import { h, api, jpost, toast, fmtBytes } from "./core.js";
import { icon } from "./icons.js";

const SEARCH_DEBOUNCE_MS = 350;
const MIN_QUERY_LEN = 2;

const card = (...body) => h("section", { class: "card" }, ...body);

/** "tt1234567" / "1234567" with a tt prefix → IMDb id; plain digits → TMDB id. */
function typedId(text) {
  const t = text.trim();
  if (/^tt\d+$/i.test(t)) return { imdb_id: t.toLowerCase() };
  if (/^\d+$/.test(t)) return { tmdb_id: Number(t) };
  return null;
}

function parsedLine(entry) {
  const parsed = [entry.parsed_title, entry.year && `(${entry.year})`].filter(Boolean).join(" ");
  return [entry.channel_title, parsed && `read as “${parsed}”`, entry.size && fmtBytes(entry.size)].filter(Boolean).join(" · ");
}

function entryCard(entry, reload) {
  const url = `/api/review/${entry.channel_id}/${entry.message_id}`;
  let timer = null;
  const results = h("div", { class: "imdb-results" });
  const query = h("input", { placeholder: "Search TMDB by title (Catalan or English)…", autocomplete: "off", value: entry.parsed_title || "" });
  const idInp = h("input", { placeholder: "or TMDB id / IMDb id (tt…)", autocomplete: "off" });

  const assign = async (ids) => {
    const r = await jpost(`${url}/assign`, ids);
    if (r) { toast(`Offered to Radarr as ${r.title}`, "ok"); reload(); }
  };
  const discard = async () => {
    const r = await jpost(`${url}/discard`, {});
    if (r) { toast("Discarded", "ok"); reload(); }
  };
  const search = async (q) => {
    if (!q || q.length < MIN_QUERY_LEN) return results.replaceChildren();
    const res = await api(`/api/tmdb/movies?q=${encodeURIComponent(q)}`); if (!res) return;
    if (!res.length) return results.replaceChildren(h("div", { class: "muted small pad" }, "No films found on TMDB. Enter the TMDB or IMDb id instead."));
    results.replaceChildren(...res.map((f) => h("button", { type: "button", class: "hit", onClick: () => assign({ tmdb_id: f.tmdb_id }) },
      f.title, h("small", {}, ` ${f.year ? `(${f.year})` : ""}${f.original_title && f.original_title !== f.title ? ` · ${f.original_title}` : ""}`))));
  };
  query.addEventListener("input", () => { clearTimeout(timer); const q = query.value; timer = setTimeout(() => search(q), SEARCH_DEBOUNCE_MS); });
  const assignTyped = () => {
    const ids = typedId(idInp.value);
    if (!ids) return toast("Enter a TMDB id (digits) or an IMDb id (tt…)", "err");
    assign(ids);
  };

  return card(
    h("div", { class: "card-h" }, entry.file_name || `Message ${entry.message_id}`),
    h("div", { class: "muted small" }, parsedLine(entry)),
    entry.caption ? h("div", { class: "small", style: "margin:8px 0;white-space:pre-line" }, entry.caption) : null,
    h("div", { class: "small", style: "color:var(--warn);margin-bottom:10px" }, entry.reason),
    h("label", {}, "Film", query), results,
    h("div", { class: "set-actions" }, idInp,
      h("button", { class: "btn primary sm", onClick: assignTyped }, "Assign"),
      h("button", { class: "btn ghost sm", onClick: discard }, h("span", { html: icon("trash") }), "Discard")));
}

function emptyState() {
  return h("div", { class: "empty-state" },
    h("div", { class: "empty-ico", html: icon("film") }),
    h("div", { class: "empty-title" }, "Nothing to review"),
    h("div", { class: "muted small" }, "Movie channel messages without a confident TMDB match appear here."));
}

export function viewReview() {
  const root = h("div", { class: "stack settings-wrap" }, h("div", { class: "empty" }, "Loading…"));
  const load = async () => {
    const entries = await api("/api/review"); if (!entries) return;
    root.replaceChildren(...(entries.length ? entries.map((e) => entryCard(e, load)) : [emptyState()]));
  };
  load();
  return root;
}
