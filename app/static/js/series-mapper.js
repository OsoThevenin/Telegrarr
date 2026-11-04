// series-mapper.js — the series identity block of the channel dialog: a TMDB
// search (Catalan titles, English fallback server-side; a TMDB link or IMDb id
// answers that one series, picked at once, and so do plain digits on Enter) +
// an editable TVDB id. Mapping is saved via PUT /api/channels/{id}/series,
// which derives the TVDB/IMDb ids.
import { h, mount, api } from "./core.js";
import { t } from "./i18n.js";
import { MIN_QUERY_LEN, seriesQuery, seriesSearchUrl, exactHit, isBareDigits } from "./series-query.js";

const SEARCH_DEBOUNCE_MS = 350;

const idsLine = (c) => [c.tvdb_id && `TVDB ${c.tvdb_id}`, c.tmdb_id && `TMDB ${c.tmdb_id}`, c.imdb_id && `IMDb ${c.imdb_id}`].filter(Boolean).join(" · ");

export function seriesMapper(channel) {
  let pick = null, timer = null, tvdbEdited = false;
  const keyNote = h("div", { class: "muted small", style: "color:var(--err)" });
  const query = h("input", { placeholder: t("chm.tmdb_search_placeholder"), autocomplete: "off", value: channel && channel.imdb_title ? channel.imdb_title : "" });
  const results = h("div", { class: "imdb-results" });
  const tvdb = h("input", { inputmode: "numeric", placeholder: t("chm.tvdb_placeholder"), value: channel && channel.tvdb_id ? channel.tvdb_id : "" });
  tvdb.addEventListener("input", () => { tvdbEdited = true; });
  const picked = h("div", { class: "imdb-picked" }, channel && idsLine(channel) ? t("chm.current", { title: channel.imdb_title || "", ids: idsLine(channel) }) : "");
  const choose = (r) => {
    const yr = r.year ? ` (${r.year})` : "";
    pick = { tmdb_id: r.tmdb_id, title: `${r.title}${yr}` };
    query.value = r.title; results.replaceChildren();
    if (!tvdbEdited) tvdb.value = "";
    picked.replaceChildren(h("span", {}, "✓ "), h("b", {}, pick.title), h("span", { class: "muted small" }, ` (TMDB ${r.tmdb_id})`));
  };
  const hitButton = (r) => h("button", { type: "button", class: "hit", onClick: () => choose(r) },
    r.title, h("small", {}, ` ${r.year ? `(${r.year})` : ""}${r.original_title && r.original_title !== r.title ? ` · ${r.original_title}` : ""}`));
  // Live search (typing, prefill) reads plain digits as a title, so a half-typed
  // "13" or a title like "1883" never maps a show by id; Enter reads them as one.
  const search = async (q, digitsAsId) => {
    if (!q || q.length < MIN_QUERY_LEN) return results.replaceChildren();
    const res = await api(seriesSearchUrl(q, digitsAsId)); if (!res) return;
    const exact = exactHit(res);
    if (exact) return choose(exact);
    const hint = !digitsAsId && isBareDigits(q) && h("div", { class: "muted small pad" }, t("chm.digits_hint", { id: q.trim() }));
    mount(results, hint, res.length ? res.map(hitButton) : h("div", { class: "muted small pad" }, t("chm.no_series")));
  };
  query.addEventListener("input", () => { clearTimeout(timer); const q = query.value; timer = setTimeout(() => search(q, false), SEARCH_DEBOUNCE_MS); });
  query.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault(); clearTimeout(timer); search(query.value.trim(), true);
  });
  api("/api/settings").then((s) => {
    if (s && !s.settings.tmdb_key_set) keyNote.textContent = t("chm.tmdb_key_required");
  });
  const node = h("div", { class: "series-map" },
    keyNote,
    h("label", {}, t("chm.series"), query), results,
    h("label", {}, t("chm.tvdb_id"), tvdb), picked);
  return {
    node,
    searchFor: (title) => {
      const q = seriesQuery(title);
      if (!query.value && q) { query.value = q; search(q, false); }
    },
    // Payload for PUT /api/channels/{id}/series, or null when nothing changed.
    payload: () => {
      const typed = tvdb.value.trim();
      if (!pick && !(tvdbEdited && typed)) return null;
      return { tmdb_id: pick ? pick.tmdb_id : null, tvdb_id: tvdbEdited ? typed : null, title: pick ? pick.title : "" };
    },
  };
}
