// directory.js — "Import from directory": scan a channel that posts links to
// per-series channels, then import the ticked ones as mapped series channels.
// The server resolves links without joining anything and reuses the last scan of
// a directory for the poll floor (account safety); this dialog only drives it.
import { h, api, jpost, mount, toast } from "./core.js";
import { icon } from "./icons.js";

const SEARCH_DEBOUNCE_MS = 350;
const RESULT_TEXT = { added: "imported", skipped: "already added", failed: "failed" };
const RESULT_TONE = { added: "ok", skipped: "muted", failed: "err" };

const fmtTime = (ts) => new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const matchLabel = (m) => m ? `${m.title}${m.year ? ` (${m.year})` : ""}` : "";

/** A small TMDB picker for one row: shows the current match, lets the user change or clear it. */
function matchPicker(entry, state) {
  const shown = h("span", {});
  const results = h("div", { class: "imdb-results" });
  const query = h("input", { placeholder: "Search TMDB…", autocomplete: "off", style: "display:none" });
  let timer = null;
  const render = () => mount(shown, state.match
    ? h("span", {}, h("b", {}, matchLabel(state.match)), h("span", { class: "muted small" }, ` · TMDB ${state.match.tmdb_id}`))
    : h("span", { class: "muted small" }, "no TMDB match (added unmapped)"));
  const choose = (m) => { state.match = m; query.style.display = "none"; results.replaceChildren(); render(); };
  const search = async (q) => {
    if (!q || q.length < 2) return results.replaceChildren();
    const res = await api(`/api/tmdb/search?q=${encodeURIComponent(q)}`); if (!res) return;
    if (!res.length) return mount(results, h("div", { class: "muted small pad" }, "No series found on TMDB."));
    results.replaceChildren(...res.slice(0, 8).map((m) => h("button", { type: "button", class: "hit", onClick: () => choose(m) },
      matchLabel(m), h("small", {}, m.original_title && m.original_title !== m.title ? ` · ${m.original_title}` : ""))));
  };
  query.addEventListener("input", () => { clearTimeout(timer); const q = query.value; timer = setTimeout(() => search(q), SEARCH_DEBOUNCE_MS); });
  const change = h("button", { type: "button", class: "btn ghost sm", onClick: () => {
    query.style.display = ""; query.value = query.value || entry.title; query.focus(); search(query.value);
  } }, "Change");
  const clear = h("button", { type: "button", class: "btn ghost sm", onClick: () => choose(null) }, "Clear");
  render();
  return h("div", { class: "dir-match" }, h("div", { class: "dir-match-row" }, shown, change, clear), query, results);
}

function entryRow(entry, state) {
  const importable = entry.resolved && !entry.already_added;
  const box = h("input", { type: "checkbox", checked: state.checked, disabled: !importable,
    "aria-label": `Import ${entry.title || entry.link}` });
  box.addEventListener("change", () => { state.checked = box.checked; state.onChange(); });
  const status = entry.already_added ? h("span", { class: "pill" }, "already added")
    : !entry.resolved ? h("span", { class: "muted small", style: "color:var(--err)" }, entry.error) : null;
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
    importBtn.textContent = `Import selected (${n})`; importBtn.disabled = !n;
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
        RESULT_TEXT[r.status] + (r.status === "failed" ? ` — ${r.detail}` : "")));
    }
    const added = res.results.filter((r) => r.status === "added").length;
    toast(added ? `Imported ${added} channel${added > 1 ? "s" : ""}` : "Nothing imported", added ? "ok" : "");
    if (added) onImported();
  };
  importBtn.addEventListener("click", doImport);
  syncButton();
  const summary = `${scan.links.length} linked channel${scan.links.length === 1 ? "" : "s"} in the last ${scan.messages_scanned} messages`
    + (scan.cached ? ` · from the scan at ${fmtTime(scan.scanned_at)} (Telegram is re-read after ${fmtTime(scan.next_scan_at)})` : "");
  return h("div", { class: "stack", style: "gap:10px" },
    h("div", { class: "muted small" }, summary),
    scan.tmdb_error ? h("div", { class: "muted small", style: "color:var(--err)" }, scan.tmdb_error) : null,
    rows.length ? h("div", { class: "dir-list" }, ...rows.map(({ entry, state }) => entryRow(entry, state)))
      : h("div", { class: "muted small pad" }, "No Telegram channel links found in this channel."),
    h("div", { class: "modal-foot" }, importBtn));
}

export function openDirectoryImport(ctx) {
  const host = document.querySelector("#modal-root");
  const picker = h("select", {}, h("option", { value: "" }, "Loading your Telegram chats…"));
  const body = h("div", {});
  const scanBtn = h("button", { class: "btn primary sm" }, h("span", { html: icon("scan") }), "Scan");
  const scan = async () => {
    if (!picker.value) return toast("Pick the directory channel first", "err");
    scanBtn.disabled = true;
    mount(body, h("div", { class: "muted small pad" }, "Scanning… links are resolved slowly to keep your account safe."));
    const res = await jpost("/api/directory/scan", { chat_id: picker.value });
    scanBtn.disabled = false;
    mount(body, res ? resultsView(res, () => ctx.refresh()) : []);
  };
  scanBtn.addEventListener("click", scan);
  api("/api/telegram/dialogs").then((dialogs) => {
    const list = (dialogs || []).filter((d) => d.kind === "channel");
    mount(picker, h("option", { value: "" }, list.length ? "Choose the directory channel…" : "No channels found"),
      ...list.map((d) => h("option", { value: d.chat_id }, d.title + (d.username ? ` (@${d.username})` : ""))));
  });

  const onKey = (e) => { if (e.key === "Escape") close(); };
  const close = () => { document.removeEventListener("keydown", onKey); host.replaceChildren(); };
  document.addEventListener("keydown", onKey);
  const overlay = h("div", { class: "modal", onClick: (e) => { if (e.target === overlay) close(); } },
    h("div", { class: "modal-card wide" },
      h("div", { class: "modal-head" }, h("h3", {}, "Import from a directory channel"),
        h("button", { class: "btn ghost icon", "aria-label": "Close", onClick: close }, h("span", { html: icon("x") }))),
      h("div", { class: "muted small" },
        "Pick a channel that posts links to series channels. Telegrarr lists the linked channels with a suggested TMDB match; "
        + "tick the ones to add. Nothing is joined: private invite links only work for channels you already belong to."),
      h("label", {}, "Directory channel", h("div", { class: "dir-pick" }, picker, scanBtn)),
      body));
  host.replaceChildren(overlay);
}
