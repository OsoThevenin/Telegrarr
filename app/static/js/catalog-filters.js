// catalog-filters.js — pure decisions behind the Catalog toolbar and footer (no DOM,
// no i18n): the filter chips, the "Mostrant X de Y" footer and the page URL.
// catalog.js turns these into elements; tests run them in node.

export const FILTER_ALL = "all";
// Chip order and labels; ids are the `filter` values GET …/catalog accepts.
export const FILTERS = [
  [FILTER_ALL, "cat.filter_all"],
  ["missing", "cat.filter_missing"],
  ["downloaded", "cat.filter_downloaded"],
  ["upgrade", "cat.filter_upgrade"],
];
const UNKNOWN_COUNT = "–";       // Radarr unavailable
const PENDING_COUNT = "…";       // Radarr still being checked

/**
 * One state per chip. `counts` are the whole channel's ({all, missing, downloaded, upgrade},
 * status ones null when Radarr wasn't read); `available` is true, false, or null while checking.
 * @returns {{id: string, label: string, count: string, pressed: boolean, disabled: boolean}[]}
 */
export function chipStates(counts, available, pressed) {
  return FILTERS.map(([id, label]) => {
    const needsRadarr = id !== FILTER_ALL;
    const known = !needsRadarr || (available === true && counts?.[id] != null);
    const placeholder = available === null ? PENDING_COUNT : UNKNOWN_COUNT;
    return {
      id, label,
      count: known ? String(counts?.[id] ?? 0) : placeholder,
      pressed: id === pressed,
      disabled: needsRadarr && available !== true,
    };
  });
}

/**
 * The footer under the list: an i18n message (`n` set for a plural one, else `params`) and
 * whether "Carrega'n més" is offered.
 * @param {{loaded: number, count: number, searching: boolean, next_offset: number|null}} page
 */
export function footerState({ loaded, count, searching, next_offset }) {
  const more = next_offset != null;
  return searching
    ? { key: "cat.results", n: count, more }
    : { key: "cat.showing", params: { shown: loaded, total: count }, more };
}

/** GET URL of one Catalog page; parameters left at their defaults are omitted. */
export function pageUrl(cid, { q, filter, offset }) {
  const params = new URLSearchParams();
  if (q && q.trim()) params.set("q", q.trim());
  if (filter && filter !== FILTER_ALL) params.set("filter", filter);
  if (offset) params.set("offset", String(offset));
  const query = params.toString();
  return `/api/channels/${cid}/catalog${query ? `?${query}` : ""}`;
}
