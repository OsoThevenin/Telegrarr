// views.js — each view builds real DOM via h(); handlers are attached inline.
import { h, mount, api, jpost, jpatch, toast, copy, gb, fmtBytes, fmtETA, base } from "./core.js";
import { icon } from "./icons.js";

const ACTIVE = new Set(["downloading", "queued"]);

// view-local UI state (persisted where it helps)
export const ui = {
  tab: "completed",
  q: "",
  sort: localStorage.getItem("dl_sort") || "new",
  dense: localStorage.getItem("density") === "1",
  sel: new Set(),
  expanded: new Set(),
};

// ── small components ──
const card = (title, ...body) => h("section", { class: "card" },
  title && h("div", { class: "card-h" }, title), ...body);

const statusPill = (s) => h("span", { class: `pill s-${s}` }, s);

function emptyState(ic, title, sub, btnLabel, onClick) {
  return h("div", { class: "empty-state" },
    h("div", { class: "empty-ico", html: icon(ic) }),
    h("div", { class: "empty-title" }, title),
    sub ? h("div", { class: "muted small" }, sub) : null,
    btnLabel ? h("button", { class: "btn primary", onClick }, btnLabel) : null);
}

function statCard(n, label, tone = "", key = "", onClick = null) {
  return h("div", { class: "stat" + (onClick ? " stat-link" : ""), onClick,
    ...(onClick ? { role: "button", tabindex: "0", title: `View ${label.toLowerCase()}`,
      onKeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } } : {}) },
    h("div", { class: `n ${tone}`, dataset: key ? { stat: key } : {} }, n),
    h("div", { class: "l" }, label));
}
const goto = (hash, tab) => { if (tab) ui.tab = tab; location.hash = hash; };

function countUp(el, to) {
  if (typeof requestAnimationFrame !== "function" || typeof performance === "undefined") { el.textContent = to; return; }
  const start = performance.now(), dur = 650;
  const tick = (t) => {
    const p = Math.min(1, (t - start) / dur);
    el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3)));
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function donutSvg(disk) {
  const pct = disk && disk.total ? disk.used / disk.total : 0;
  const R = 54, C = 2 * Math.PI * R, off = C * (1 - pct);
  // Graduated: healthy = brand blue, amber past 85%, red only past 95% — alarm
  // colour is reserved for an actual alarm, not "disk filling up".
  const stroke = pct > 0.95 ? "var(--err)" : pct > 0.85 ? "var(--warn)" : "url(#dgrad)";
  return `<svg viewBox="0 0 140 140" class="donut" aria-hidden="true">
    <defs><linearGradient id="dgrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0071e3"/><stop offset="1" stop-color="#2997ff"/></linearGradient></defs>
    <circle cx="70" cy="70" r="${R}" fill="none" stroke="var(--surface-2)" stroke-width="12"/>
    <circle id="donut-arc" cx="70" cy="70" r="${R}" fill="none" stroke="${stroke}" stroke-width="13" stroke-linecap="round" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 70 70)"/>
    <text id="donut-pct" x="70" y="72" text-anchor="middle" class="donut-pct">${Math.round(pct * 100)}%</text>
    <text x="70" y="92" text-anchor="middle" class="donut-sub">used</text>
  </svg>`;
}

const diskLegend = (disk) => [h("span", {}, `${fmtBytes(disk.used || 0)} used`), h("span", {}, `${fmtBytes(disk.free || 0)} free`)];

function activeCard(d, ctx) {
  const pct = Math.round((d.progress || 0) * 100), eta = fmtETA(d);
  return h("div", { class: "active-card" },
    h("div", { class: "ac-top" },
      h("span", { class: "ac-name", title: d.save_path }, base(d.save_path) || d.file_name),
      statusPill(d.status),
      h("button", { class: "btn ghost sm", onClick: async () => { await api(`/api/downloads/${d.id}/cancel`, { method: "POST" }); ctx.refresh(); } },
        h("span", { html: icon("pause") }), "Stop")),
    h("div", { class: "ac-meta" },
      `${d.channel_title || ""} · ${d.file_size ? gb(d.file_size) : "—"} · ` +
      `${d.status === "downloading" ? (d.speed_mbs || 0).toFixed(1) + " MB/s" : "waiting"}${eta ? " · " + eta : ""} · ${pct}%`),
    h("div", { class: "bar" }, h("i", { style: `width:${pct}%` })));
}

const activeList = (downloads, ctx) => {
  const act = downloads.filter((d) => ACTIVE.has(d.status))
    .sort((a, b) => (a.status === b.status ? 0 : a.status === "downloading" ? -1 : 1));
  // Empty → render nothing (the caller collapses), so idle pages don't carry a
  // big "No active downloads." dead band.
  return act.length ? act.map((d) => activeCard(d, ctx)) : [];
};

// ── Dashboard ──
const recentList = (dls) => {
  const recent = (dls || []).filter((d) => d.status === "completed")
    .sort((a, b) => (b.finished_at || 0) - (a.finished_at || 0)).slice(0, 6);
  if (!recent.length) return [h("div", { class: "empty small" }, "No downloads yet.")];
  return recent.map((d) => h("div", { class: "recent-row" },
    h("span", { class: "rc-name", title: d.save_path }, base(d.save_path) || d.file_name),
    h("span", { class: "rc-meta mono" },
      [d.file_size ? fmtBytes(d.file_size) : null, d.finished_at ? fmtWhen(d.finished_at) : null]
        .filter(Boolean).join(" · "))));
};

export function viewDashboard(ctx) {
  const st = (ctx.data.status && ctx.data.status.stats) || {};
  const disk = (ctx.data.status && ctx.data.status.disk) || {};
  const speed = (ctx.data.status && ctx.data.status.speed) || 0;
  const strip = h("div", { class: "stat-strip" },
    statCard(st.channels ?? 0, "Channels", "", "channels", () => goto("#/channels")),
    statCard(st.downloading ?? 0, "Downloading", "accent", "downloading"),
    statCard(st.queued ?? 0, "Queued", "warn", "queued"),
    statCard(st.completed ?? 0, "Completed", "ok", "completed", () => goto("#/downloads", "completed")),
    statCard(st.failed ?? 0, "Failed", st.failed ? "err" : "", "failed", () => goto("#/downloads", "failed")),
    statCard(fmtBytes(st.total_size || 0), "Library", "", "lib", () => goto("#/channels")));
  const activeItems = activeList(ctx.data.downloads, ctx);
  const activeSection = h("section", { class: "card" },
    h("div", { class: "card-h dash-active-head" },
      h("span", {}, "Active now"),
      h("span", { class: "dash-speed mono", id: "dash-speed" }, speed > 0 ? speed.toFixed(1) + " MB/s" : "")),
    h("div", { class: "active-list", id: "dash-active" },
      ...(activeItems.length ? activeItems : [h("div", { class: "dash-idle muted small" }, "Nothing downloading right now.")])));
  const root = h("div", { class: "stack" },
    strip,
    activeSection,
    h("div", { class: "grid-2" },
      card("Up next", h("div", { class: "upnext", id: "dash-upnext" }, h("div", { class: "empty small" }, "Loading…"))),
      card("Storage",
        h("div", { class: "donut-wrap", html: donutSvg(disk) }),
        h("div", { class: "meter-legend", id: "disk-legend" }, ...diskLegend(disk)))),
    card("Recently grabbed", h("div", { class: "recent-list" }, ...recentList(ctx.data.downloads))));
  // Up next: soonest scheduled channel scans (async — fills the idle dashboard).
  (async () => {
    const tasks = await api("/api/system/tasks");
    const el = root.querySelector("#dash-upnext"); if (!el) return;
    const up = (tasks || []).filter((t) => t.enabled && t.next_run)
      .sort((a, b) => a.next_run - b.next_run).slice(0, 5);
    if (!up.length) { mount(el, h("div", { class: "empty small" }, "No channels scheduled.")); return; }
    mount(el, ...up.map((t) => h("div", { class: "upnext-row" },
      h("span", { class: "un-name" }, t.name.replace(/^Scan · /, "")),
      h("span", { class: "un-when mono" }, fmtWhen(t.next_run)))));
  })();
  setTimeout(() => {
    root.querySelectorAll("[data-stat]").forEach((el) => {
      if (el.dataset.stat === "lib") return;
      const v = parseInt(el.textContent); if (!isNaN(v)) { el.textContent = "0"; countUp(el, v); }
    });
  }, 0);
  return root;
}

// in-place dashboard refresh driven by SSE (smooth, avoids re-animating counters)
export function liveDashboard(ctx) {
  const st = (ctx.data.status && ctx.data.status.stats) || {};
  const disk = (ctx.data.status && ctx.data.status.disk) || {};
  const set = (k, v) => { const el = document.querySelector(`[data-stat="${k}"]`); if (el) el.textContent = v; };
  set("channels", st.channels ?? 0); set("downloading", st.downloading ?? 0);
  set("queued", st.queued ?? 0); set("completed", st.completed ?? 0);
  set("failed", st.failed ?? 0); set("lib", fmtBytes(st.total_size || 0));
  if (disk.total) {
    const R = 54, C = 2 * Math.PI * R, pct = disk.used / disk.total;
    const arc = document.querySelector("#donut-arc"), pctEl = document.querySelector("#donut-pct");
    if (arc) arc.setAttribute("stroke-dashoffset", (C * (1 - pct)).toFixed(1));
    if (pctEl) pctEl.textContent = Math.round(pct * 100) + "%";
    const leg = document.querySelector("#disk-legend"); if (leg) mount(leg, ...diskLegend(disk));
  }
  const da = document.querySelector("#dash-active");
  if (da) {
    const items = activeList(ctx.data.downloads, ctx);
    mount(da, ...(items.length ? items : [h("div", { class: "dash-idle muted small" }, "Nothing downloading right now.")]));
  }
  const speed = (ctx.data.status && ctx.data.status.speed) || 0;
  const sp = document.querySelector("#dash-speed"); if (sp) sp.textContent = speed > 0 ? speed.toFixed(1) + " MB/s" : "";
}

// ── Channels (poster library) ──
const _artCache = new Map();
function loadArt(imdb, img, poster) {
  if (!imdb) return;
  const apply = (a) => { if (a && a.poster) { img.src = a.poster; img.classList.add("loaded"); } if (a && a.backdrop) poster.dataset.backdrop = a.backdrop; poster.classList.add("art-done"); };
  if (_artCache.has(imdb)) return apply(_artCache.get(imdb));
  api(`/api/art?imdb=${encodeURIComponent(imdb)}`).then((a) => { _artCache.set(imdb, a || {}); apply(a || {}); });
}

// A "show" is one or more source channels sharing an IMDb mapping. Grouping
// lets several channels feed one title (some go stale, others post the new ep).
const showKey = (c) => (c.imdb_id || "").trim() || (c.imdb_title || "").trim() || ("ch:" + c.id);
const scanAll = async (group) => { for (const c of group) await api(`/api/channels/${c.id}/scan`, { method: "POST" }); toast(`Scanning ${group.length} source${group.length > 1 ? "s" : ""}`, "ok"); };
const backfillAll = async (group) => { for (const c of group) await api(`/api/channels/${c.id}/backfill`, { method: "POST" }); toast("Backfill started", "ok"); };

function showCard(group, ctx) {
  const rep = group.find((c) => c.imdb_id) || group[0];
  const multi = group.length > 1;
  const days = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
  const dstr = (rep.weekdays || "").split(",").filter((x) => x !== "").map((i) => days[i]).join(" ");
  const anyEnabled = group.some((c) => c.enabled);
  const img = h("img", { class: "poster-img", alt: "", loading: "lazy" });
  const poster = h("div", { class: "poster", onClick: () => openChannelDrawer(ctx, rep, group) },
    h("span", { class: "poster-fallback", html: icon("film") }), img,
    multi ? h("span", { class: "src-badge" }, group.length + " sources") : null,
    h("button", { class: `toggle ch-toggle ${anyEnabled ? "on" : ""}`, title: anyEnabled ? "Enabled" : "Disabled", "aria-label": "Toggle",
      onClick: async (e) => { e.stopPropagation(); const to = anyEnabled ? 0 : 1; for (const c of group) await jpatch(`/api/channels/${c.id}`, { enabled: to }); ctx.refresh(); } }));
  loadArt(rep.imdb_id, img, poster);
  if (!rep.imdb_id) poster.classList.add("art-done");
  return h("div", { class: "ch-card" }, poster,
    h("div", { class: "ch-body" },
      h("div", { class: "ch-title", title: rep.imdb_title || rep.title }, rep.imdb_title || rep.title),
      h("div", { class: "ch-meta" }, multi ? `${rep.kind} · ${group.length} sources` : `${rep.kind} · ${dstr || "—"} · ${rep.poll_minutes}m`),
      h("div", { class: "ch-actions" },
        h("button", { class: "btn ghost sm", onClick: () => scanAll(group) }, h("span", { html: icon("scan") }), "Scan"),
        h("button", { class: "btn ghost sm", onClick: () => backfillAll(group) }, "Backfill"),
        multi
          ? h("button", { class: "btn ghost sm", onClick: () => openChannelDrawer(ctx, rep, group) }, h("span", { html: icon("channels") }), "Sources")
          : h("button", { class: "btn ghost sm icon", title: "Edit", "aria-label": "Edit channel", onClick: () => openChannelModal(ctx, rep) }, h("span", { html: icon("edit") })),
        multi ? null
          : h("button", { class: "btn ghost sm icon", title: "Remove", "aria-label": "Remove channel", onClick: async () => { if (confirm("Remove this channel? Download history is kept.")) { await api(`/api/channels/${rep.id}`, { method: "DELETE" }); toast("Channel removed", "ok"); ctx.refresh(); } } }, h("span", { html: icon("trash") })))));
}

export function viewChannels(ctx) {
  const rows = ctx.data.channels || [];
  if (!rows.length) return emptyState("channels", "No channels yet", "Add a Telegram channel to start grabbing episodes.", "Add channel", () => openChannelModal(ctx, null));
  const groups = new Map();
  for (const c of rows) { const k = showKey(c); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c); }
  return h("div", { class: "ch-grid" }, ...[...groups.values()].map((g) => showCard(g, ctx)));
}

// hero-backdrop detail drawer for a channel
export function openChannelDrawer(ctx, c, group = null) {
  const host = document.querySelector("#modal-root");
  const grp = group && group.length ? group : [c];
  const ids = new Set(grp.map((x) => x.id));
  const art = _artCache.get(c.imdb_id) || {};
  const eps = (ctx.data.downloads || []).filter((d) => ids.has(d.channel_id) && d.status === "completed")
    .sort((a, b) => (b.finished_at || 0) - (a.finished_at || 0));
  const hero = h("div", { class: "hero" });
  const posterBox = h("div", { class: "drawer-poster" });
  const overview = h("p", { class: "drawer-overview muted" });
  const meta = h("div", { class: "drawer-meta muted small" });
  const fill = (a) => {
    if (a.backdrop) hero.style.backgroundImage = `url(${a.backdrop})`;
    else if (a.poster) hero.style.backgroundImage = `url(${a.poster})`;
    mount(posterBox, a.poster ? h("img", { src: a.poster, alt: "" }) : h("span", { class: "poster-fallback", html: icon("film") }));
    overview.textContent = a.overview || "";
    meta.textContent = [a.year, c.kind, a.rating ? "★ " + a.rating : "", c.imdb_id || ""].filter(Boolean).join("  ·  ");
  };
  fill(art);
  if (!_artCache.has(c.imdb_id) && c.imdb_id) api(`/api/art?imdb=${encodeURIComponent(c.imdb_id)}`).then((a) => { _artCache.set(c.imdb_id, a || {}); fill(a || {}); });

  const onKey = (e) => { if (e.key === "Escape") close(); };
  const close = () => { document.removeEventListener("keydown", onKey); host.replaceChildren(); };
  document.addEventListener("keydown", onKey);
  const drawer = h("div", { class: "drawer", onClick: (e) => { if (e.target === drawer) close(); } },
    h("div", { class: "drawer-card" },
      h("div", { class: "hero-wrap" }, hero, h("div", { class: "hero-fade" }),
        h("button", { class: "btn ghost icon drawer-x", "aria-label": "Close", onClick: close }, h("span", { html: icon("x") }))),
      h("div", { class: "drawer-body" },
        h("div", { class: "drawer-head" }, posterBox,
          h("div", { class: "drawer-info" },
            h("h2", {}, c.imdb_title || c.title), meta, overview,
            h("div", { class: "drawer-actions" },
              h("button", { class: "btn primary sm", onClick: () => scanAll(grp) }, h("span", { html: icon("scan") }), "Scan"),
              h("button", { class: "btn ghost sm", onClick: () => backfillAll(grp) }, "Backfill"),
              grp.length === 1
                ? h("button", { class: "btn ghost sm", onClick: () => { close(); openChannelModal(ctx, c); } }, h("span", { html: icon("edit") }), "Edit")
                : null))),
        grp.length > 1 ? h("div", { class: "drawer-eps" },
          h("div", { class: "card-h" }, `${grp.length} source channels`),
          ...grp.map((s) => h("div", { class: "src-row" },
            h("span", { class: "dot " + (s.enabled ? "ok" : "bad") }),
            h("span", { class: "src-name", title: s.title }, s.title),
            h("button", { class: "btn ghost sm", onClick: async () => { await jpatch(`/api/channels/${s.id}`, { enabled: s.enabled ? 0 : 1 }); close(); ctx.refresh(); } }, s.enabled ? "Disable" : "Enable"),
            h("button", { class: "btn ghost sm", onClick: () => { close(); openChannelModal(ctx, s); } }, "Edit"),
            h("button", { class: "btn ghost sm icon", title: "Remove source", "aria-label": "Remove source", onClick: async () => { if (confirm("Remove this source channel? Download history is kept.")) { await api(`/api/channels/${s.id}`, { method: "DELETE" }); toast("Source removed", "ok"); close(); ctx.refresh(); } } }, h("span", { html: icon("trash") }))))) : null,
        h("div", { class: "drawer-eps" },
          h("div", { class: "card-h" }, `${eps.length} episode${eps.length === 1 ? "" : "s"} downloaded`),
          ...(eps.length ? eps.slice(0, 60).map((d) => h("div", { class: "ep-row" },
            h("span", { class: "ep-name" }, base(d.save_path) || d.file_name),
            h("span", { class: "muted small" }, d.file_size ? gb(d.file_size) : "")))
            : [h("div", { class: "muted small pad" }, "No downloads yet.")])))));
  host.replaceChildren(drawer);
}

// ── Downloads ──
const counts = (dls) => dls.reduce((c, d) => (c[d.status] = (c[d.status] || 0) + 1, c),
  { completed: 0, failed: 0, cancelled: 0, downloading: 0, queued: 0 });

function sortRows(rows) {
  return [...rows].sort((a, b) => {
    if (ui.sort === "big") return (b.file_size || 0) - (a.file_size || 0);
    if (ui.sort === "name") return (base(a.save_path) || a.file_name || "").localeCompare(base(b.save_path) || b.file_name || "");
    const ta = a.finished_at || a.created_at || 0, tb = b.finished_at || b.created_at || 0;
    return ui.sort === "old" ? ta - tb : tb - ta;
  });
}
const matchQ = (d) => !ui.q || (base(d.save_path) || d.file_name || "").toLowerCase().includes(ui.q.toLowerCase())
  || (d.channel_title || "").toLowerCase().includes(ui.q.toLowerCase());

function rowsTable(rows, ctx, selectAll = true) {
  const allSel = rows.length && rows.every((d) => ui.sel.has(d.id));
  const head = h("tr", {},
    h("th", { class: "cb" }, selectAll ? h("input", {
      type: "checkbox", checked: allSel, "aria-label": "Select all",
      onChange: (e) => { rows.forEach((d) => e.target.checked ? ui.sel.add(d.id) : ui.sel.delete(d.id)); ctx.rerender(); },
    }) : null),
    ...["File", "Channel", "Size", "Status", "When", ""].map((t) => h("th", {}, t)));
  const body = rows.map((d) => h("tr", { class: ui.sel.has(d.id) ? "selrow" : "" },
    h("td", { class: "cb" }, h("input", {
      type: "checkbox", checked: ui.sel.has(d.id), "aria-label": "Select row",
      onChange: (e) => { e.target.checked ? ui.sel.add(d.id) : ui.sel.delete(d.id); ctx.rerender(); },
    })),
    h("td", { title: d.save_path }, base(d.save_path) || d.file_name),
    h("td", {}, d.channel_title || "—"),
    h("td", {}, d.file_size ? gb(d.file_size) : "—"),
    h("td", {}, statusPill(d.status)),
    h("td", { class: "muted small" }, d.finished_at ? new Date(d.finished_at * 1000).toLocaleDateString() : ""),
    h("td", { class: "actions" },
      (d.status === "failed" || d.status === "cancelled") ? h("button", { class: "btn ghost sm", onClick: async () => { await api(`/api/downloads/${d.id}/retry`, { method: "POST" }); toast("Re-queued", "ok"); ctx.refresh(); } }, "Retry") : null,
      h("button", { class: "btn ghost sm icon", title: "Delete", "aria-label": "Delete record", onClick: async () => { await api(`/api/downloads/${d.id}`, { method: "DELETE" }); ctx.refresh(); } }, h("span", { html: icon("trash") })))));
  return h("table", {}, h("thead", {}, head), h("tbody", {}, ...body));
}

// Group by the SHOW (its library folder), not the channel — so multiple source
// channels for one title collapse into a single group. Movies (no Season folder)
// fall back to the channel name.
function showOf(d) {
  const m = (d.save_path || "").match(/\/([^/]+)\/Season\s[^/]*\/[^/]*$/i);
  return m ? m[1] : (d.channel_title || "Unknown");
}
function completedGrouped(dls, ctx) {
  let rows = dls.filter((d) => d.status === "completed" && matchQ(d));
  if (ui.q) return rows.length ? h("div", { class: "data-card" }, rowsTable(sortRows(rows), ctx)) : h("div", { class: "empty" }, "No matches.");
  if (!rows.length) return h("div", { class: "empty" }, "Nothing downloaded yet.");
  const groups = {};
  rows.forEach((d) => { const k = showOf(d); (groups[k] ||= []).push(d); });
  return h("div", { class: "stack" }, ...Object.keys(groups).sort().map((name) => {
    const items = sortRows(groups[name]); const size = items.reduce((s, d) => s + (d.file_size || 0), 0);
    const open = ui.expanded.has(name);
    const toggle = () => { open ? ui.expanded.delete(name) : ui.expanded.add(name); ctx.rerender(); };
    return h("div", { class: "grp" },
      h("div", {
        class: "grp-head", role: "button", tabindex: "0", "aria-expanded": open ? "true" : "false", "aria-label": `Toggle ${name}`,
        onClick: toggle, onKeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } },
      },
        h("span", { class: "tw", html: icon(open ? "chevron-down" : "chevron-right") }),
        h("span", { class: "grp-name" }, name),
        h("span", { class: "grp-meta" }, `${items.length} episode${items.length > 1 ? "s" : ""} · ${gb(size)}`),
        h("button", {
          class: "btn ghost sm", onClick: async (e) => {
            e.stopPropagation();
            const ids = items.map((d) => d.id);
            if (confirm(`Remove ${ids.length} completed record(s) for ${name}? Files on disk are kept.`)) { await jpost("/api/downloads/bulk", { action: "delete", ids }); ctx.refresh(); }
          },
        }, "Clear")),
      open ? h("div", { class: "grp-body" }, rowsTable(items, ctx, false)) : null);
  }));
}

export function viewDownloads(ctx) {
  const dls = ctx.data.downloads || []; const c = counts(dls);
  const tab = (k, label) => h("button", { class: `tab ${ui.tab === k ? "on" : ""}`, onClick: () => { ui.tab = k; ctx.rerender(); } }, label, h("b", {}, c[k] || 0));
  const controls = h("div", { class: "dl-controls" },
    h("div", { class: "tabs" }, tab("completed", "Completed"), tab("failed", "Failed"), tab("cancelled", "Cancelled")),
    h("input", { id: "dl-search", type: "search", placeholder: "Filter…", value: ui.q, onInput: (e) => { ui.q = e.target.value; ctx.rerender(); } }),
    h("select", { class: "mini", title: "Sort", onChange: (e) => { ui.sort = e.target.value; localStorage.setItem("dl_sort", ui.sort); ctx.rerender(); } },
      ...[["new", "Newest"], ["old", "Oldest"], ["big", "Largest"], ["name", "Name A→Z"]].map(([v, l]) => h("option", { value: v, selected: ui.sort === v }, l))),
    h("button", { class: "btn ghost sm icon", title: "Toggle density", "aria-label": "Toggle row density", onClick: () => { ui.dense = !ui.dense; localStorage.setItem("density", ui.dense ? "1" : "0"); document.body.classList.toggle("dense", ui.dense); ctx.rerender(); } }, h("span", { html: icon("filter") })));

  // bulk bar
  const sel = dls.filter((d) => ui.sel.has(d.id));
  const bulk = h("div", { class: "bulk-bar" });
  if (ui.sel.size) {
    bulk.append(h("span", {}, h("b", {}, ui.sel.size), " selected"));
    if (sel.some((d) => d.status === "failed" || d.status === "cancelled"))
      bulk.append(h("button", { class: "btn ghost sm", onClick: async () => { await jpost("/api/downloads/bulk", { action: "retry", ids: [...ui.sel] }); ui.sel.clear(); ctx.refresh(); } }, "Retry"));
    bulk.append(h("button", { class: "btn danger sm", onClick: async () => { await jpost("/api/downloads/bulk", { action: "delete", ids: [...ui.sel] }); ui.sel.clear(); ctx.refresh(); } }, "Delete"));
    bulk.append(h("button", { class: "btn ghost sm", onClick: () => { ui.sel.clear(); ctx.rerender(); } }, "Clear selection"));
  }
  bulk.append(h("span", { class: "spacer" }));
  if (c.failed) bulk.append(h("button", { class: "btn ghost sm", onClick: async () => { const ids = dls.filter((d) => d.status === "failed").map((d) => d.id); if (confirm(`Delete ${ids.length} failed record(s)?`)) { await jpost("/api/downloads/bulk", { action: "delete", ids }); ctx.refresh(); } } }, `Clear ${c.failed} failed`));

  const body = ui.tab === "completed" ? completedGrouped(dls, ctx)
    : (() => { const rows = dls.filter((d) => d.status === ui.tab && matchQ(d)); return rows.length ? h("div", { class: "data-card" }, rowsTable(sortRows(rows), ctx)) : h("div", { class: "empty" }, "Nothing here."); })();

  return h("div", { class: "stack" },
    h("div", { class: "active-list", id: "dl-active" }, ...activeList(dls, ctx)),
    controls, bulk, body);
}

// live active-download list (used by SSE to update without rebuilding the whole view)
export const liveActive = (ctx) => activeList(ctx.data.downloads, ctx);

// ── Activity (logs) ──
function logRow(l) {
  const cls = l.level === "ERROR" ? "lg-error" : l.level === "WARN" ? "lg-warn" : "lg-info";
  return h("div", { class: "log-row" },
    h("span", { class: "lg-badge " + cls }, l.level),
    h("span", { class: "lg-msg" }, l.message,
      l.count > 1 ? h("span", { class: "lg-count", title: `${l.count} times` }, "×" + l.count) : null),
    h("span", { class: "lg-time mono", title: new Date(l.ts * 1000).toLocaleString() }, fmtWhen(l.ts)));
}
export function viewActivity(ctx) {
  const list = h("div", { class: "log-list", id: "log-list" }, h("div", { class: "empty" }, "Loading…"));
  const lvlSel = h("select", { class: "mini", onChange: () => load() },
    ...[["", "All levels"], ["ERROR", "Errors"], ["WARN", "Warnings"], ["INFO", "Info"]].map(([v, l]) => h("option", { value: v }, l)));
  const search = h("input", { class: "mini", type: "search", placeholder: "Search log…", oninput: () => load() });
  async function load() {
    const rows = await api("/api/logs?limit=500"); if (!rows) return;
    const lvl = lvlSel.value, q = search.value.trim().toLowerCase();
    const filtered = rows.filter((l) => (!lvl || l.level === lvl) && (!q || l.message.toLowerCase().includes(q)));
    // Collapse consecutive identical entries into one row with a ×N count —
    // otherwise a repeating error (e.g. every 30s) buries everything else.
    const grouped = [];
    for (const l of filtered) {
      const last = grouped[grouped.length - 1];
      if (last && last.level === l.level && last.message === l.message) { last.count++; last.ts = Math.max(last.ts, l.ts); }
      else grouped.push({ ...l, count: 1 });
    }
    mount(list, grouped.length
      ? h("div", {}, ...grouped.map(logRow))
      : h("div", { class: "empty" }, "No matching log entries."));
  }
  load();
  const refresh = h("button", { class: "btn ghost sm", onClick: () => load() }, h("span", { html: icon("refresh") }), "Refresh");
  return h("div", { class: "stack" },
    h("div", { class: "log-toolbar" }, lvlSel, search, h("span", { class: "spacer", style: "flex:1" }), refresh),
    list);
}

// ── System ──
function fmtDur(sec) {
  sec = Math.max(0, sec | 0);
  const d = Math.floor(sec / 86400), hh = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  if (d) return `${d}d ${hh}h`;
  if (hh) return `${hh}h ${m}m`;
  if (m) return `${m}m`;
  return `${sec}s`;
}
function fmtWhen(ts) {
  if (!ts) return "—";
  const diff = Date.now() / 1000 - ts;
  if (diff < 0) {
    const s = -diff;
    if (s < 60) return "in <1m";
    if (s < 3600) return `in ${Math.round(s / 60)}m`;
    if (s < 86400) return `in ${Math.round(s / 3600)}h`;
    return new Date(ts * 1000).toLocaleString();
  }
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return new Date(ts * 1000).toLocaleDateString();
}
const infoGrid = (pairs) => h("div", { class: "info-grid" },
  ...pairs.flatMap(([k, v]) => [h("div", { class: "info-k" }, k), h("div", { class: "info-v mono" }, String(v))]));

const SYS_TABS = [["status", "Status"], ["tasks", "Tasks"], ["backup", "Backup"], ["updates", "Updates"]];

export function viewSystem(ctx) {
  const sub = ui.sysTab || "status";
  const body = h("div", { class: "stack" }, h("div", { class: "empty" }, "Loading…"));
  const tabs = h("div", { class: "tabs" }, ...SYS_TABS.map(([id, label]) =>
    h("button", { class: "tab " + (sub === id ? "on" : ""), onClick: () => { ui.sysTab = id; ctx.rerender(); } }, label)));
  ({ status: sysStatus, tasks: sysTasks, backup: sysBackup, updates: sysUpdates }[sub])(body);
  return h("div", { class: "stack" }, tabs, body);
}

async function sysStatus(root) {
  const s = await api("/api/system/status"); if (!s) return;
  const badge = (ok, level) => h("span", { class: "pill " + (ok ? "s-completed" : (level === "warn" ? "s-queued" : "s-failed")) },
    ok ? "OK" : (level === "warn" ? "Warning" : "Error"));
  const health = card("Health",
    h("div", { class: "sys-health" }, ...s.health.map((x) =>
      h("div", { class: "sys-hrow" },
        h("span", { class: "dot " + (x.ok ? "ok" : (x.level === "warn" ? "" : "bad")) }),
        h("span", { class: "sys-hname" }, x.name),
        h("span", { class: "sys-hmsg muted" }, x.message),
        badge(x.ok, x.level)))));
  const about = card("About", infoGrid([
    ["Version", "v" + s.version],
    ["Python", s.python],
    ["Platform", s.platform],
    ["Uptime", fmtDur(s.uptime_seconds)],
    ["Channels", `${s.channels_enabled} enabled · ${s.channels} total`],
    ["Download workers", `${s.workers} senders · ${s.max_concurrent} concurrent`],
    ["Database", fmtBytes(s.db_size)],
    ["Disk", `${fmtBytes(s.disk.free)} free of ${fmtBytes(s.disk.total)}`],
    ["Data directory", s.data_dir],
  ]));
  mount(root, health, about);
}

async function sysTasks(root) {
  const rows = await api("/api/system/tasks"); if (!rows) return;
  const head = h("div", { class: "dl-controls" },
    h("button", { class: "btn primary sm", onClick: async () => { const r = await jpost("/api/system/tasks/scan_all", {}); if (r) toast(r.message || "Scanning", "ok"); } },
      h("span", { html: icon("scan") }), "Scan all now"),
    h("span", { class: "muted small" }, "Each enabled channel is scanned on its own schedule."));
  const table = h("div", { class: "data-card" }, h("table", {},
    h("thead", {}, h("tr", {}, h("th", {}, "Task"), h("th", {}, "Interval"), h("th", {}, "Days"), h("th", {}, "Last run"), h("th", {}, "Next run"), h("th", {}, ""))),
    h("tbody", {}, ...(rows.length ? rows.map((t) => h("tr", {},
      h("td", {}, t.name),
      h("td", { class: "num" }, t.interval),
      h("td", { class: "muted" }, t.days),
      h("td", { class: "num muted" }, fmtWhen(t.last_run)),
      h("td", { class: "num" }, t.enabled ? fmtWhen(t.next_run) : h("span", { class: "muted" }, "disabled")),
      h("td", { class: "actions" }, h("button", { class: "btn ghost sm", onClick: async () => { await api(`/api/channels/${t.channel_id}/scan`, { method: "POST" }); toast("Scan started", "ok"); } }, "Run"))))
      : [h("tr", {}, h("td", { colspan: 6 }, h("div", { class: "empty" }, "No channels yet — add one to schedule scans.")))]))));
  mount(root, head, table);
}

async function sysBackup(root) {
  const list = (await api("/api/system/backups")) || [];
  const head = h("div", { class: "dl-controls" },
    h("button", { class: "btn primary sm", onClick: async () => { const r = await jpost("/api/system/backups", {}); if (r && r.name) { toast("Backup created", "ok"); sysBackup(root); } } },
      h("span", { html: icon("disk") }), "Back up now"),
    h("span", { class: "muted small" }, "Snapshots your database + settings. Keeps the latest 10."));
  const table = h("div", { class: "data-card" }, h("table", {},
    h("thead", {}, h("tr", {}, h("th", {}, "Backup"), h("th", {}, "Size"), h("th", {}, "Created"), h("th", {}, ""))),
    h("tbody", {}, ...(list.length ? list.map((b) => h("tr", {},
      h("td", {}, b.name),
      h("td", { class: "num" }, fmtBytes(b.size)),
      h("td", { class: "num muted" }, fmtWhen(b.created)),
      h("td", { class: "actions" },
        h("a", { class: "btn ghost sm", href: `/api/system/backups/${encodeURIComponent(b.name)}/download` }, h("span", { html: icon("external") }), "Download"),
        h("button", { class: "btn ghost sm icon", title: "Delete backup", onClick: async () => { if (confirm("Delete this backup?")) { await api(`/api/system/backups/${encodeURIComponent(b.name)}`, { method: "DELETE" }); toast("Backup deleted", "ok"); sysBackup(root); } } }, h("span", { html: icon("trash") })))))
      : [h("tr", {}, h("td", { colspan: 4 }, h("div", { class: "empty" }, "No backups yet.")))]))));
  const note = card("Restore",
    h("p", { class: "muted small", style: "margin:0;line-height:1.6" },
      "To restore: download a backup, stop Telearr, unzip telearr.db into your data directory, and start again. Restoring replaces all channels, history, and settings."));
  mount(root, head, table, note);
}

async function sysUpdates(root) {
  const u = await api("/api/system/updates"); if (!u) return;
  const status = u.up_to_date
    ? h("div", { class: "chip" }, h("span", { html: icon("check") }), u.latest ? "You're on the latest version" : "No newer release found")
    : h("div", { class: "chip", style: "background:color-mix(in srgb,var(--accent) 14%,transparent);color:var(--accent)" }, h("span", { html: icon("upload") }), `Update available: v${u.latest}`);
  mount(root, card("Updates",
    infoGrid([
      ["Installed", "v" + u.current],
      ["Latest", u.latest ? "v" + u.latest : (u.error || "unknown")],
    ]),
    h("div", { style: "margin-top:16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap" },
      status,
      h("a", { class: "btn ghost sm", href: u.url, target: "_blank", rel: "noopener" }, h("span", { html: icon("external") }), "Release notes"))));
}

// ── Settings ──
export function viewSettings(ctx) {
  const root = h("div", { class: "stack settings-wrap" }, h("div", { class: "empty" }, "Loading…"));
  (async () => {
    const data = await api("/api/settings"); if (!data) return;
    const s = data.settings, p = data.paths, arrKey = (data.arr || {}).apikey || "";
    const row = (label, input, hint) => h("div", { class: "set-row" },
      h("label", {}, label, hint && h("div", { class: "hint" }, hint)), input);
    const inp = (id, val, type = "text") => h("input", { id, value: val ?? "", type });

    const account = card("Account",
      row("Username", inp("acct-username", data.user || ""), "how you sign in"),
      row("Confirm password", inp("uname-cur", "", "password"), "required to change username"),
      h("div", { class: "set-actions" },
        h("button", { class: "btn primary sm", onClick: async () => {
          const r = await jpost("/api/account/username", { username: root.querySelector("#acct-username").value, current: root.querySelector("#uname-cur").value });
          if (r) { toast("Username changed to " + r.username, "ok"); ctx.rerender(); }
        } }, "Change username")),
      h("div", { class: "card-h", style: "margin-top:20px" }, "Password"),
      row("Current password", inp("pw-cur", "", "password")),
      row("New password", inp("pw-new", "", "password"), "min 12 characters"),
      h("div", { class: "set-actions" },
        h("button", { class: "btn primary sm", onClick: async () => { const r = await jpost("/api/account/password", { current: root.querySelector("#pw-cur").value, new: root.querySelector("#pw-new").value }); if (r) { toast("Password changed", "ok"); root.querySelector("#pw-cur").value = ""; root.querySelector("#pw-new").value = ""; } } }, "Change password"),
        h("a", { class: "btn ghost sm", href: "/logout" }, h("span", { html: icon("logout") }), "Sign out")));

    const themeBtn = (v, l) => h("button", { class: `btn ghost sm ${ctx.getTheme() === v ? "on" : ""}`, onClick: () => { ctx.setTheme(v); ctx.rerender(); } }, l);
    const appearance = card("Appearance", row("Theme", h("div", { class: "theme-pick" }, themeBtn("auto", "Auto"), themeBtn("light", "Light"), themeBtn("dark", "Dark"))));

    const perf = card("Performance",
      row("Parallel connections", inp("set-dl_workers", s.dl_workers, "number"), "per download · too high triggers Telegram FloodWait"),
      row("Concurrent downloads", inp("set-max_concurrent", s.max_concurrent, "number")),
      row("Min free space (GB)", inp("set-min_free_gb", s.min_free_gb, "number")),
      row("Default poll (min)", inp("set-default_poll_minutes", s.default_poll_minutes, "number"), `minimum ${s.poll_floor_minutes} · random jitter added to protect the account`),
      row("Daily budget (GB)", inp("set-daily_budget_gb", s.daily_budget_gb, "number"), "0 = unlimited · downloads pause until midnight once reached"),
      row("Keep per show", inp("set-history_limit_per_show", s.history_limit_per_show, "number"), "completed records to keep · 0 = all (files always kept)"),
      h("div", { class: "set-actions" }, h("button", {
        class: "btn primary sm", onClick: async () => {
          const g = (k) => root.querySelector("#set-" + k).value;
          const r = await jpatch("/api/settings", { dl_workers: g("dl_workers"), max_concurrent: g("max_concurrent"), min_free_gb: g("min_free_gb"), default_poll_minutes: g("default_poll_minutes"), daily_budget_gb: g("daily_budget_gb"), history_limit_per_show: g("history_limit_per_show") });
          if (r) toast("Performance saved", "ok");
        },
      }, "Save performance")));

    const plexOut = h("span", { class: "test-out" });
    const plex = card("Plex",
      row("Server URL", inp("set-plex_url", s.plex_url), "e.g. http://plex_local:32400"),
      row("Token" + (s.plex_token_set ? " (saved)" : ""), inp("set-plex_token", "", "password")),
      h("div", { class: "set-actions" },
        h("button", { class: "btn primary sm", onClick: async () => { const f = { plex_url: root.querySelector("#set-plex_url").value }; const tk = root.querySelector("#set-plex_token").value; if (tk) f.plex_token = tk; await jpatch("/api/settings", f); toast("Plex settings saved", "ok"); } }, "Save"),
        h("button", { class: "btn ghost sm", onClick: async () => { const r = await api("/api/integrations/plex/test", { method: "POST" }); if (r) { plexOut.textContent = r.detail; plexOut.style.color = `var(--${r.ok ? "ok" : "err"})`; } } }, "Test"), plexOut));

    const notifyOut = h("span", { class: "test-out" });
    const tgChk = h("input", { type: "checkbox", id: "set-notify_telegram",
      onChange: async (e) => { await jpatch("/api/settings", { notify_telegram: e.target.checked }); toast(e.target.checked ? "Telegram DMs on" : "Telegram DMs off", "ok"); } });
    if (s.notify_telegram) tgChk.checked = true;
    const notify = card("Notifications",
      row(h("span", {}, "Telegram Saved Messages"), h("div", { class: "chkwrap" }, tgChk), "DM each completed download to your own Telegram account"),
      row("Webhook URL", inp("set-notify_webhook", s.notify_webhook), "Discord / Slack / generic JSON (optional)"),
      h("div", { class: "set-actions" },
        h("button", { class: "btn primary sm", onClick: async () => { await jpatch("/api/settings", { notify_webhook: root.querySelector("#set-notify_webhook").value }); toast("Webhook saved", "ok"); } }, "Save webhook"),
        h("button", { class: "btn ghost sm", onClick: async () => { notifyOut.textContent = "Sending…"; notifyOut.style.color = "var(--muted)"; const r = await api("/api/integrations/notify/test", { method: "POST" }); if (r) { notifyOut.textContent = r.detail; notifyOut.style.color = `var(--${r.ok ? "ok" : "err"})`; } } }, "Send test"), notifyOut));

    const tmdbOut = h("span", { class: "test-out" });
    const tmdbc = card("Artwork (TMDB)",
      h("div", { class: "muted small", style: "margin-bottom:10px" }, "Posters work automatically via IMDb — no key needed. Add a free TMDB key (themoviedb.org → Settings → API) for higher-resolution artwork and backdrops."),
      row("API key" + (s.tmdb_key_set ? " (saved)" : ""), inp("set-tmdb_key", "", "password")),
      h("div", { class: "set-actions" },
        h("button", { class: "btn primary sm", onClick: async () => { const tk = root.querySelector("#set-tmdb_key").value; if (tk) await jpatch("/api/settings", { tmdb_key: tk }); toast("TMDB key saved", "ok"); } }, "Save"),
        h("button", { class: "btn ghost sm", onClick: async () => { tmdbOut.textContent = "Testing…"; tmdbOut.style.color = "var(--muted)"; const r = await jpost("/api/integrations/tmdb/test", { key: root.querySelector("#set-tmdb_key").value }); if (r) { tmdbOut.textContent = r.detail; tmdbOut.style.color = `var(--${r.ok ? "ok" : "err"})`; } } }, "Test"), tmdbOut),
      h("div", { class: "muted small", style: "margin-top:10px" }, "This product uses the TMDB API but is not endorsed or certified by TMDB."));

    const keyInp = inp("arr-key", arrKey); keyInp.readOnly = true;
    const nzInp = inp("arr-nzb", `${location.origin}/api/newznab`); nzInp.readOnly = true;
    const arr = card("Sonarr / Radarr / Prowlarr",
      h("div", { class: "muted small", style: "margin-bottom:10px" }, "Add Telearr as a Newznab indexer and a SABnzbd download client. See docs/ARR_INTEGRATION.md."),
      row("Newznab URL", nzInp),
      row("SABnzbd host / port", (() => { const i = inp("arr-sab", `${location.hostname} : ${location.port || 8790}`); i.readOnly = true; return i; })()),
      row("API key", keyInp),
      h("div", { class: "set-actions" },
        h("button", { class: "btn ghost sm", onClick: () => copy(nzInp.value) }, h("span", { html: icon("copy") }), "Copy URL"),
        h("button", { class: "btn ghost sm", onClick: () => copy(keyInp.value) }, h("span", { html: icon("copy") }), "Copy key"),
        h("button", { class: "btn ghost sm", onClick: async () => { const r = await jpost("/api/integrations/arr/regenerate", {}); if (r) { keyInp.value = r.apikey; toast("API key regenerated", "ok"); } } }, h("span", { html: icon("refresh") }), "Regenerate key")));

    const paths = card("Library paths",
      h("div", { class: "muted small" }, h("div", {}, `TV → ${p.tv_dir}`), h("div", {}, `TV 4K → ${p.tv_dir_4k}`), h("div", {}, `Movies → ${p.movies_dir}`), h("div", {}, `Other → ${p.other_dir}`), h("div", { style: "margin-top:6px" }, "Edit via .env and rebuild.")));

    const tgAuth = (await api("/api/telegram/auth")) || {};
    const tgCard = card("Telegram account",
      h("div", { class: "muted small", style: "margin-bottom:10px" }, tgAuth.authorized
        ? "Connected — Telearr is signed in to your Telegram account."
        : "Not connected. Connect your account so Telearr can read your channels."),
      h("div", { class: "set-actions" }, tgAuth.authorized
        ? h("button", { class: "btn ghost sm", onClick: async () => { if (confirm("Disconnect Telegram? Downloads stop until you reconnect.")) { await api("/api/telegram/auth/logout", { method: "POST" }); toast("Telegram disconnected", "ok"); ctx.rerender(); } } }, "Disconnect")
        : h("button", { class: "btn primary sm", onClick: () => openTelegramConnect(ctx) }, h("span", { html: icon("telegram") }), "Connect Telegram")));

    const proxyOut = h("span", { class: "test-out" });
    const proxyInp = inp("set-proxy", "", "text");
    proxyInp.placeholder = s.proxy_set ? "•••• (a proxy is set — enter a new URL to replace)" : "socks5://user:pass@host:port";
    const proxyc = card("Proxy / VPN",
      h("div", { class: "muted small", style: "margin-bottom:10px" }, "Route Telegram through a proxy when your ISP throttles or blocks Telegram data centers (fixes downloads that stall/fail on a specific DC). Supports socks5://, socks4://, http:// and mtproxy://<secret>@host:port."),
      row("Proxy URL" + (s.proxy_set ? " (set)" : ""), proxyInp),
      h("div", { class: "set-actions" },
        h("button", { class: "btn primary sm", onClick: async () => {
          proxyOut.textContent = "Connecting through proxy…"; proxyOut.style.color = "var(--muted)";
          const r = await jpost("/api/telegram/proxy", { proxy: proxyInp.value });
          if (r) { const ok = !r.error; proxyOut.textContent = ok ? ("Connected via " + (r.proxy || "direct")) : r.error; proxyOut.style.color = `var(--${ok ? "ok" : "err"})`; if (ok) proxyInp.value = ""; }
        } }, "Save & test"),
        s.proxy_set ? h("button", { class: "btn ghost sm", onClick: async () => { const r = await jpost("/api/telegram/proxy", { proxy: "" }); if (r && !r.error) { toast("Proxy cleared", "ok"); ctx.rerender(); } } }, "Clear") : null,
        proxyOut));

    // Grouped into tabs (was one long column). Cards are built once; switching
    // tabs just re-parents them, so unsaved input and handlers survive.
    const TABS = [
      ["account", "Account", [account, appearance]],
      ["downloads", "Downloads", [perf, paths]],
      ["integrations", "Integrations", [tgCard, proxyc, plex, tmdbc, notify, arr]],
    ];
    const tabsRow = h("div", { class: "tabs" });
    const body = h("div", { class: "settings-cols" });
    const renderTab = () => {
      const cur = TABS.some((t) => t[0] === ui.setTab) ? ui.setTab : "account";
      mount(tabsRow, ...TABS.map(([k, label]) =>
        h("button", { class: "tab " + (cur === k ? "on" : ""), onClick: () => { ui.setTab = k; renderTab(); } }, label)));
      mount(body, ...TABS.find((t) => t[0] === cur)[2]);
    };
    renderTab();
    root.replaceChildren(tabsRow, body);
  })();
  return root;
}

// ── Channel modal (add / edit) with IMDb picker ──
// ── Telegram connect wizard ──
export function openTelegramConnect(ctx) {
  const host = document.querySelector("#modal-root");
  const body = h("div", { class: "tg-wiz" });
  const err = h("div", { class: "tg-err" });
  const onKey = (e) => { if (e.key === "Escape") close(); };
  const close = () => { document.removeEventListener("keydown", onKey); host.replaceChildren(); ctx.refresh(); };
  document.addEventListener("keydown", onKey);
  const say = (m, kind) => { err.textContent = m || ""; err.style.color = kind === "err" ? "var(--err)" : "var(--muted)"; };
  const field = (label, attrs) => { const i = h("input", attrs); return { el: h("label", {}, label, i), input: i }; };

  const step = (name) => {
    say("");
    if (name === "api") {
      const a = field("API ID", { placeholder: "e.g. 123456", inputmode: "numeric" });
      const b = field("API Hash", { placeholder: "e.g. a1b2c3…" });
      mount(body,
        h("p", { class: "muted small" }, "Create a Telegram app at ", h("a", { href: "https://my.telegram.org", target: "_blank", rel: "noopener" }, "my.telegram.org"), " → API development tools, then paste the two values below."),
        a.el, b.el,
        h("button", { class: "btn primary block", onClick: async () => { say("Saving…"); const r = await jpost("/api/telegram/auth/api", { api_id: a.input.value, api_hash: b.input.value }); r && r.ok ? step("phone") : say((r && r.error) || "Failed", "err"); } }, "Continue"));
      a.input.focus();
    } else if (name === "phone") {
      const p = field("Phone number", { placeholder: "+15551234567", inputmode: "tel" });
      mount(body,
        h("p", { class: "muted small" }, "Enter your Telegram phone number with country code. Telegram will send you a login code."),
        p.el,
        h("button", { class: "btn primary block", onClick: async () => { say("Sending code…"); const r = await jpost("/api/telegram/auth/send_code", { phone: p.input.value }); r && r.ok ? step("code") : say((r && r.error) || "Could not send code", "err"); } }, "Send code"));
      p.input.focus();
    } else if (name === "code") {
      const c = field("Login code", { placeholder: "12345", inputmode: "numeric", autocomplete: "one-time-code" });
      mount(body,
        h("p", { class: "muted small" }, "Enter the code Telegram just sent (check the Telegram app on your phone)."),
        c.el,
        h("button", { class: "btn primary block", onClick: async () => { say("Verifying…"); const r = await jpost("/api/telegram/auth/sign_in", { code: c.input.value }); r && r.ok ? step("done") : r && r.need_password ? step("password") : say((r && r.error) || "Invalid code", "err"); } }, "Verify"),
        h("button", { class: "btn ghost sm block", onClick: () => step("phone") }, "← Use a different number"));
      c.input.focus();
    } else if (name === "password") {
      const w = field("Two-step password", { type: "password", placeholder: "Your Telegram 2FA password" });
      mount(body,
        h("p", { class: "muted small" }, "Your account has two-step verification enabled. Enter your Telegram password."),
        w.el,
        h("button", { class: "btn primary block", onClick: async () => { say("Signing in…"); const r = await jpost("/api/telegram/auth/password", { password: w.input.value }); r && r.ok ? step("done") : say((r && r.error) || "Wrong password", "err"); } }, "Sign in"));
      w.input.focus();
    } else {
      mount(body, h("div", { class: "tg-done" },
        h("span", { class: "tg-check", html: icon("check") }),
        h("h3", {}, "Telegram connected"),
        h("p", { class: "muted small" }, "Telearr is signed in and can now watch your channels."),
        h("button", { class: "btn primary block", onClick: close }, "Done")));
    }
  };

  const overlay = h("div", { class: "modal", onClick: (e) => { if (e.target === overlay) close(); } },
    h("div", { class: "modal-card" },
      h("div", { class: "modal-head" }, h("h3", {}, "Connect Telegram"),
        h("button", { class: "btn ghost icon", "aria-label": "Close", onClick: close }, h("span", { html: icon("x") }))),
      body, err));
  host.replaceChildren(overlay);
  api("/api/telegram/auth").then((a) => step(a && a.api_ready ? "phone" : "api"));
}

const POLL_FLOOR_MIN = 15;   // account safety: mirrors config.POLL_FLOOR_MINUTES (server enforces it)

export function openChannelModal(ctx, channel) {
  const host = document.querySelector("#modal-root");
  let pick = null, imdbTimer = null;
  let selected = channel ? { chat_id: channel.chat_id, title: channel.imdb_title || channel.title } : null;
  const kind = h("select", {}, ...["tv", "movie", "other"].map((k) => h("option", { value: k, selected: channel && channel.kind === k }, k === "tv" ? "TV show" : k === "movie" ? "Movie" : "Other")));
  const poll = h("input", { type: "number", min: String(POLL_FLOOR_MIN), value: channel ? Math.max(POLL_FLOOR_MIN, channel.poll_minutes) : POLL_FLOOR_MIN });
  const daysOn = channel ? (channel.weekdays || "").split(",") : ["0", "1", "2", "3", "4", "5", "6"];
  const dayBtns = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d, i) =>
    h("button", { type: "button", class: `m-day ${daysOn.includes(String(i)) ? "on" : ""}`, dataset: { day: i }, onClick: (e) => e.target.classList.toggle("on") }, d));
  const imdbQ = h("input", { placeholder: "Search IMDb by title…", autocomplete: "off", value: channel && channel.imdb_title ? channel.imdb_title : "" });
  const results = h("div", { class: "imdb-results" });
  const picked = h("div", { class: "imdb-picked" }, channel && channel.imdb_id ? `Current: ${channel.imdb_title || ""} (${channel.imdb_id})` : "");
  const doImdbSearch = async (q) => {
    if (!q || q.length < 2) return results.replaceChildren();
    const res = await api(`/api/imdb/search?q=${encodeURIComponent(q)}`); if (!res) return;
    results.replaceChildren(...res.map((r) => h("button", { type: "button", class: "hit",
      onClick: () => { const yr = r.year ? ` (${r.year})` : ""; pick = { imdb_id: r.imdb_id, imdb_title: `${r.title}${yr}` }; imdbQ.value = r.title; results.replaceChildren(); picked.replaceChildren(h("span", {}, "✓ "), h("b", {}, pick.imdb_title), h("span", { class: "muted small" }, ` (${r.imdb_id})`)); },
    }, r.title, h("small", {}, ` ${r.year ? `(${r.year})` : ""} · ${r.kind || ""}`))));
  };
  imdbQ.addEventListener("input", () => { clearTimeout(imdbTimer); const q = imdbQ.value; imdbTimer = setTimeout(() => doImdbSearch(q), 350); });

  // ── channel selection ──
  let chanArea;
  if (channel) {
    chanArea = h("label", {}, "Telegram channel", h("input", { value: `${channel.imdb_title || channel.title} (${channel.chat_id})`, disabled: true }));
  } else {
    const chanQ = h("input", { placeholder: "Search your channels, or paste @username / t.me / invite link", autocomplete: "off" });
    const chanList = h("div", { class: "chan-list" }, h("div", { class: "muted small pad" }, "Loading your Telegram chats…"));
    const chanSel = h("div", { class: "chan-selected" });
    let dialogs = [];
    const showSel = () => mount(chanSel, selected
      ? h("div", { class: "chip" }, h("span", { html: icon("check") }), h("span", {}, `${selected.title} · ${selected.chat_id}`)) : []);
    const selectChan = (d) => { selected = { chat_id: d.chat_id, title: d.title }; showSel(); renderList(); if (!imdbQ.value && d.title) { imdbQ.value = d.title; doImdbSearch(d.title); } };
    const resolveChan = async () => {
      mount(chanList, h("div", { class: "muted small pad" }, "Resolving…"));
      const r = await jpost("/api/telegram/resolve", { query: chanQ.value.trim() });
      if (r && r.chat_id) { selectChan(r); toast("Channel resolved" + (r.username ? " @" + r.username : ""), "ok"); }
      else { toast((r && r.error) || "Could not resolve", "err"); renderList(); }
    };
    const renderList = () => {
      const q = chanQ.value.trim();
      const ql = q.toLowerCase();
      const items = dialogs.filter((d) => !ql || (d.title + " " + d.username).toLowerCase().includes(ql));
      const nodes = [];
      if (/t\.me\/|joinchat|^@|^\+|^https?:/i.test(q))
        nodes.push(h("button", { type: "button", class: "chan-item resolve", onclick: resolveChan }, h("span", { class: "ci-ic", html: icon("link") }), h("span", {}, `Resolve “${q}”`)));
      nodes.push(...items.slice(0, 80).map((d) => h("button", { type: "button", class: "chan-item" + (selected && String(selected.chat_id) === String(d.chat_id) ? " on" : ""), onclick: () => selectChan(d) },
        h("span", { class: "ci-ic", html: icon(d.kind === "channel" ? "channels" : "folder") }),
        h("span", { class: "ci-main" }, h("span", { class: "ci-title" }, d.title), h("span", { class: "ci-sub" }, (d.username ? "@" + d.username + " · " : "") + d.kind)))));
      if (!nodes.length) nodes.push(h("div", { class: "muted small pad" }, dialogs.length ? "No matches — paste a @username / t.me / invite link." : "No channels found — paste a link to add one."));
      mount(chanList, ...nodes);
    };
    chanQ.addEventListener("input", renderList);
    api("/api/telegram/dialogs").then((d) => { dialogs = d || []; if (!dialogs.length) mount(chanList, h("div", { class: "muted small pad" }, "No Telegram chats found. Paste a @username / t.me / invite link above.")); else renderList(); });
    chanArea = h("label", {}, "Telegram channel", chanQ, chanList, chanSel);
  }

  const onKey = (e) => { if (e.key === "Escape") close(); };
  const close = () => { document.removeEventListener("keydown", onKey); host.replaceChildren(); };
  document.addEventListener("keydown", onKey);
  const save = async () => {
    const weekdays = dayBtns.filter((b) => b.classList.contains("on")).map((b) => b.dataset.day).join(",") || "0,1,2,3,4,5,6";
    const pm = parseInt(poll.value) || POLL_FLOOR_MIN;
    if (channel) {
      const patch = { kind: kind.value, weekdays, poll_minutes: pm };
      if (pick) Object.assign(patch, pick);
      if (!(await jpatch(`/api/channels/${channel.id}`, patch))) return;
      toast("Channel updated", "ok");
    } else {
      if (!selected) return toast("Pick a channel or resolve a link first", "err");
      const ch = await jpost("/api/channels", { chat_id: selected.chat_id, kind: kind.value, weekdays, poll_minutes: pm });
      if (!ch) return;
      if (ch && ch.id && pick) await jpatch(`/api/channels/${ch.id}`, pick);
      if (ch) toast("Channel added", "ok");
    }
    close(); ctx.refresh();
  };

  const overlay = h("div", { class: "modal", onClick: (e) => { if (e.target === overlay) close(); } },
    h("div", { class: "modal-card" },
      h("div", { class: "modal-head" }, h("h3", {}, channel ? "Edit channel" : "Add channel"),
        h("button", { class: "btn ghost icon", "aria-label": "Close", onClick: close }, h("span", { html: icon("x") }))),
      chanArea,
      h("label", {}, "Kind", kind),
      h("label", {}, "Scan on days"), h("div", { class: "days" }, ...dayBtns),
      h("label", {}, "Poll interval (minutes)", poll),
      h("label", {}, "IMDb match", imdbQ), results, picked,
      h("div", { class: "modal-foot" },
        h("button", { class: "btn ghost", onClick: close }, "Cancel"),
        h("button", { class: "btn primary", onClick: save }, "Save"))));
  host.replaceChildren(overlay);
}
