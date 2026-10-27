// directory.js — "Import from directory": scan a channel that posts links to
// per-series channels, then import the ticked ones as mapped series channels.
// The server resolves links without joining anything and reuses the last scan of
// a directory for the poll floor (account safety); this dialog only drives it.
// A forum group can be scanned whole or on one topic (e.g. "Sèries HD").
import { h, api, jpost, mount, toast } from "./core.js";
import { icon } from "./icons.js";
import { t, tn, msg, fmtTime as fmtClock } from "./i18n.js";
import { topicPicker } from "./topics.js";

const SEARCH_DEBOUNCE_MS = 350;
const RESULT_TONE = { added: "ok", skipped: "muted", failed: "err" };

const fmtTime = (ts) => fmtClock(new Date(ts * 1000));
const matchLabel = (m) => m ? `${m.title}${m.year ? ` (${m.year})` : ""}` : "";

/** A small TMDB picker for one row: shows the current match, lets the user change or clear it. */
function matchPicker(entry, state) {
  const shown = h("span", {});
  const results = h("div", { class: "imdb-results" });
  const query = h("input", { placeholder: t("directory.search_tmdb"), autocomplete: "off", style: "display:none" });
  let timer = null;
  const render = () => mount(shown, state.match
    ? h("span", {}, h("b", {}, matchLabel(state.match)), h("span", { class: "muted small" }, ` · TMDB ${state.match.tmdb_id}`))
    : h("span", { class: "muted small" }, t("directory.no_match")));
  const choose = (m) => { state.match = m; query.style.display = "none"; results.replaceChildren(); render(); };
  const search = async (q) => {
    if (!q || q.length < 2) return results.replaceChildren();
    const res = await api(`/api/tmdb/search?q=${encodeURIComponent(q)}`); if (!res) return;
    if (!res.length) return mount(results, h("div", { class: "muted small pad" }, t("directory.no_series_found")));
    results.replaceChildren(...res.slice(0, 8).map((m) => h("button", { type: "button", class: "hit", onClick: () => choose(m) },
      matchLabel(m), h("small", {}, m.original_title && m.original_title !== m.title ? ` · ${m.original_title}` : ""))));
  };
  query.addEventListener("input", () => { clearTimeout(timer); const q = query.value; timer = setTimeout(() => search(q), SEARCH_DEBOUNCE_MS); });
  const change = h("button", { type: "button", class: "btn ghost sm", onClick: () => {
    query.style.display = ""; query.value = query.value || entry.title; query.focus(); search(query.value);
  } }, t("common.change"));
  const clear = h("button", { type: "button", class: "btn ghost sm", onClick: () => choose(null) }, t("common.clear"));
  render();
  return h("div", { class: "dir-match" }, h("div", { class: "dir-match-row" }, shown, change, clear), query, results);
}

function entryRow(entry, state) {
  const importable = entry.resolved && !entry.already_added;
  const box = h("input", { type: "checkbox", checked: state.checked, disabled: !importable,
    "aria-label": t("directory.import_aria", { title: entry.title || entry.link }) });
  box.addEventListener("change", () => { state.checked = box.checked; state.onChange(); });
  const status = entry.already_added ? h("span", { class: "pill" }, t("directory.added_pill"))
    : !entry.resolved ? h("span", { class: "muted small", style: "color:var(--err)" }, msg(entry.error)) : null;
  return h("div", { class: "dir-row" + (importable ? "" : " off") },
    box,
    h("div", { class: "ci-main" },
      h("span", { class: "ci-title" }, entry.title || entry.link),
      h("span", { class: "ci-sub" }, entry.username ? `@${entry.username}` : entry.link),
      status,
      importable ? matchPicker(entry, state) : null,
      state.result));
}

function resultsView(scan, onImported) {
  const rows = scan.links.map((entry) => ({ entry, state: {
    checked: entry.resolved && !entry.already_added && !!entry.suggestion,
    match: entry.suggestion, result: h("div", { class: "small" }), onChange: () => syncButton() } }));
  const importBtn = h("button", { class: "btn primary" });
  const syncButton = () => {
    const n = rows.filter((r) => r.state.checked).length;
    importBtn.textContent = t("directory.import_selected", { n }); importBtn.disabled = !n;
  };
  const doImport = async () => {
    const picked = rows.filter((r) => r.state.checked);
    importBtn.disabled = true;
    const res = await jpost("/api/directory/import", { channels: picked.map(({ entry, state }) => ({
      chat_id: entry.chat_id, title: entry.title,
      tmdb_id: state.match ? state.match.tmdb_id : null, series_title: matchLabel(state.match) })) });
    syncButton(); if (!res) return;
    const byChat = new Map(res.results.map((r) => [String(r.chat_id), r]));
    for (const { entry, state } of picked) {
      const r = byChat.get(String(entry.chat_id)); if (!r) continue;
      mount(state.result, h("span", { style: `color:var(--${RESULT_TONE[r.status]})` },
        t(`directory.result.${r.status}`) + (r.status === "failed" ? ` — ${msg(r.detail)}` : "")));
    }
    const added = res.results.filter((r) => r.status === "added").length;
    toast(added ? tn("directory.imported", added) : t("directory.nothing_imported"), added ? "ok" : "");
    if (added) onImported();
  };
  importBtn.addEventListener("click", doImport);
  syncButton();
  const summary = tn("directory.summary", scan.links.length, { messages: scan.messages_scanned })
    + (scan.cached ? " · " + t("directory.cached", { at: fmtTime(scan.scanned_at), next: fmtTime(scan.next_scan_at) }) : "");
  return h("div", { class: "stack", style: "gap:10px" },
    h("div", { class: "muted small" }, summary),
    scan.tmdb_error ? h("div", { class: "muted small", style: "color:var(--err)" }, msg(scan.tmdb_error)) : null,
    rows.length ? h("div", { class: "dir-list" }, ...rows.map(({ entry, state }) => entryRow(entry, state)))
      : h("div", { class: "muted small pad" }, t("directory.no_links")),
    h("div", { class: "modal-foot" }, importBtn));
}

export function openDirectoryImport(ctx) {
  const host = document.querySelector("#modal-root");
  const picker = h("select", {}, h("option", { value: "" }, t("directory.loading_chats")));
  const body = h("div", {});
  const topics = topicPicker({ multiple: false, hint: t("directory.topics_hint") });
  let topicsReady = Promise.resolve(false);
  picker.addEventListener("change", () => {
    mount(body);
    if (!picker.value) { topics.clear(); topicsReady = Promise.resolve(false); return; }
    topicsReady = topics.load(picker.value);
  });
  const scanBtn = h("button", { class: "btn primary sm" }, h("span", { html: icon("scan") }), t("common.scan"));
  const scan = async () => {
    if (!picker.value) return toast(t("directory.pick_first"), "err");
    scanBtn.disabled = true;
    await topicsReady;
    // a forum group with no topic picked is scanned whole
    const topicId = topics.isForum() ? (topics.picked()[0]?.topic_id ?? null) : null;
    mount(body, h("div", { class: "muted small pad" }, t("directory.scanning")));
    const res = await jpost("/api/directory/scan", { chat_id: picker.value, topic_id: topicId });
    scanBtn.disabled = false;
    mount(body, res ? resultsView(res, () => ctx.refresh()) : []);
  };
  scanBtn.addEventListener("click", scan);
  api("/api/telegram/dialogs").then((dialogs) => {
    // groups too: a forum group's topic can be the directory
    const list = (dialogs || []).filter((d) => d.kind === "channel" || d.kind === "group");
    mount(picker, h("option", { value: "" }, list.length ? t("directory.choose") : t("directory.no_channels")),
      ...list.map((d) => h("option", { value: d.chat_id }, d.title + (d.username ? ` (@${d.username})` : ""))));
  });

  const onKey = (e) => { if (e.key === "Escape") close(); };
  const close = () => { document.removeEventListener("keydown", onKey); host.replaceChildren(); };
  document.addEventListener("keydown", onKey);
  const overlay = h("div", { class: "modal", onClick: (e) => { if (e.target === overlay) close(); } },
    h("div", { class: "modal-card wide" },
      h("div", { class: "modal-head" }, h("h3", {}, t("directory.title")),
        h("button", { class: "btn ghost icon", "aria-label": t("common.close"), onClick: close }, h("span", { html: icon("x") }))),
      h("div", { class: "muted small" },
        t("directory.intro")),
      h("label", {}, t("directory.channel"), h("div", { class: "dir-pick" }, picker, scanBtn)),
      topics.node,
      body));
  host.replaceChildren(overlay);
}
