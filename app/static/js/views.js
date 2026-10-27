// views.js — each view builds real DOM via h(); handlers are attached inline.
import { h, mount, api, jpost, jpatch, jput, toast, copy, gb, fmtBytes, fmtETA, base } from "./core.js";
import { icon } from "./icons.js";
import { openTelegramConnect } from "./telegram-connect.js";
import { sourceTitle, isWholeForum } from "./topics.js";
import { channelTopics } from "./channel-topics.js";
import { isRetryable, retryableIds } from "./retry.js";
import { t, tn, tOr, msg, lang, locale, fmtDateTime } from "./i18n.js";

const ACTIVE = new Set(["downloading", "queued"]);
const chanLabel = (c) => sourceTitle(c.title, c.topic_title);            // a channel row's source label
const dlSource = (d) => sourceTitle(d.channel_title, d.topic_title);     // a download row's source label
const WEEKDAYS = t("common.weekdays_short").split(" ");   // Monday first, index = weekday number
const kindLabel = (k) => tOr(`kind.${k}`, k);
export const fmtWeekdays = (days) => (days || []).length === 7 ? t("common.every_day")
  : (days || []).map((i) => WEEKDAYS[i]).join(" ") || "—";

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
export const card = (title, ...body) => h("section", { class: "card" },
  title && h("div", { class: "card-h" }, title), ...body);

const statusPill = (s) => h("span", { class: `pill s-${s}` }, tOr(`status.${s}`, s));

function emptyState(ic, title, sub, btnLabel, onClick) {
  return h("div", { class: "empty-state" },
    h("div", { class: "empty-ico", html: icon(ic) }),
    h("div", { class: "empty-title" }, title),
    sub ? h("div", { class: "muted small" }, sub) : null,
    btnLabel ? h("button", { class: "btn primary", onClick }, btnLabel) : null);
}

function statCard(n, label, tone = "", key = "", onClick = null) {
  return h("div", { class: "stat" + (onClick ? " stat-link" : ""), onClick,
    ...(onClick ? { role: "button", tabindex: "0", title: t("dash.view_stat", { label: label.toLowerCase() }),
      onKeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } } : {}) },
    h("div", { class: `n ${tone}`, dataset: key ? { stat: key } : {} }, n),
    h("div", { class: "l" }, label));
}
const goto = (hash, tab) => { if (tab) ui.tab = tab; location.hash = hash; };

function countUp(el, to) {
  if (typeof requestAnimationFrame !== "function" || typeof performance === "undefined") { el.textContent = to; return; }
  const start = performance.now(), dur = 650;
  const tick = (now) => {
    const p = Math.min(1, (now - start) / dur);
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
    <text x="70" y="92" text-anchor="middle" class="donut-sub">${t("dash.used")}</text>
  </svg>`;
}

const diskLegend = (disk) => [h("span", {}, t("dash.bytes_used", { size: fmtBytes(disk.used || 0) })), h("span", {}, t("dash.bytes_free", { size: fmtBytes(disk.free || 0) }))];

function activeCard(d, ctx) {
  const pct = Math.round((d.progress || 0) * 100), eta = fmtETA(d);
  return h("div", { class: "active-card" },
    h("div", { class: "ac-top" },
      h("span", { class: "ac-name", title: d.save_path }, base(d.save_path) || d.file_name),
      statusPill(d.status),
      h("button", { class: "btn ghost sm", onClick: async () => { await api(`/api/downloads/${d.id}/cancel`, { method: "POST" }); ctx.refresh(); } },
        h("span", { html: icon("pause") }), t("dl.stop"))),
    h("div", { class: "ac-meta" },
      `${sourceTitle(d.channel_title, d.topic_title) || ""} · ${d.file_size ? gb(d.file_size) : "—"} · ` +
      `${d.status === "downloading" ? (d.speed_mbs || 0).toFixed(1) + " MB/s" : t("dl.waiting")}${eta ? " · " + eta : ""} · ${pct}%`),
    errorNote(d),
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
  if (!recent.length) return [h("div", { class: "empty small" }, t("dash.no_downloads"))];
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
    statCard(st.channels ?? 0, t("nav.channels"), "", "channels", () => goto("#/channels")),
    statCard(st.downloading ?? 0, t("dash.stat.downloading"), "accent", "downloading"),
    statCard(st.queued ?? 0, t("dash.stat.queued"), "warn", "queued"),
    statCard(st.completed ?? 0, t("dash.stat.completed"), "ok", "completed", () => goto("#/downloads", "completed")),
    statCard(st.failed ?? 0, t("dash.stat.failed"), st.failed ? "err" : "", "failed", () => goto("#/downloads", "failed")),
    statCard(fmtBytes(st.total_size || 0), t("dash.stat.library"), "", "lib", () => goto("#/channels")));
  const activeItems = activeList(ctx.data.downloads, ctx);
  const activeSection = h("section", { class: "card" },
    h("div", { class: "card-h dash-active-head" },
      h("span", {}, t("dash.active_now")),
      h("span", { class: "dash-speed mono", id: "dash-speed" }, speed > 0 ? speed.toFixed(1) + " MB/s" : "")),
    h("div", { class: "active-list", id: "dash-active" },
      ...(activeItems.length ? activeItems : [h("div", { class: "dash-idle muted small" }, t("dash.idle"))])));
  const root = h("div", { class: "stack" },
    strip,
    activeSection,
    h("div", { class: "grid-2" },
      card(t("dash.up_next"), h("div", { class: "upnext", id: "dash-upnext" }, h("div", { class: "empty small" }, t("common.loading")))),
      card(t("dash.storage"),
        h("div", { class: "donut-wrap", html: donutSvg(disk) }),
        h("div", { class: "meter-legend", id: "disk-legend" }, ...diskLegend(disk)))),
    card(t("dash.recent"), h("div", { class: "recent-list" }, ...recentList(ctx.data.downloads))));
  // Up next: soonest scheduled channel scans (async — fills the idle dashboard).
  (async () => {
    const tasks = await api("/api/system/tasks");
    const el = root.querySelector("#dash-upnext"); if (!el) return;
    const up = (tasks || []).filter((task) => task.enabled && task.next_run)
      .sort((a, b) => a.next_run - b.next_run).slice(0, 5);
    if (!up.length) { mount(el, h("div", { class: "empty small" }, t("dash.none_scheduled"))); return; }
    mount(el, ...up.map((task) => h("div", { class: "upnext-row" },
      h("span", { class: "un-name" }, task.title),
      h("span", { class: "un-when mono" }, fmtWhen(task.next_run)))));
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
    mount(da, ...(items.length ? items : [h("div", { class: "dash-idle muted small" }, t("dash.idle"))]));
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
const scanAll = async (group) => { for (const c of group) await api(`/api/channels/${c.id}/scan`, { method: "POST" }); toast(tn("ch.scanning_sources", group.length), "ok"); };
const backfillAll = async (group) => { for (const c of group) await api(`/api/channels/${c.id}/backfill`, { method: "POST" }); toast(t("ch.backfill_started"), "ok"); };

function showCard(group, ctx) {
  const rep = group.find((c) => c.imdb_id) || group[0];
  const multi = group.length > 1;
  const dstr = (rep.weekdays || "").split(",").filter((x) => x !== "").map((i) => WEEKDAYS[i]).join(" ");
  const anyEnabled = group.some((c) => c.enabled);
  const img = h("img", { class: "poster-img", alt: "", loading: "lazy" });
  const poster = h("div", { class: "poster", onClick: () => openChannelDrawer(ctx, rep, group) },
    h("span", { class: "poster-fallback", html: icon("film") }), img,
    multi ? h("span", { class: "src-badge" }, tn("ch.sources", group.length)) : null,
    h("button", { class: `toggle ch-toggle ${anyEnabled ? "on" : ""}`, title: anyEnabled ? t("common.enabled") : t("common.disabled"), "aria-label": t("common.toggle"),
      onClick: async (e) => { e.stopPropagation(); const to = anyEnabled ? 0 : 1; for (const c of group) await jpatch(`/api/channels/${c.id}`, { enabled: to }); ctx.refresh(); } }));
  loadArt(rep.imdb_id, img, poster);
  if (!rep.imdb_id) poster.classList.add("art-done");
  return h("div", { class: "ch-card" }, poster,
    h("div", { class: "ch-body" },
      h("div", { class: "ch-title", title: rep.imdb_title || chanLabel(rep) }, rep.imdb_title || chanLabel(rep)),
      !multi && rep.imdb_title && rep.topic_title ? h("div", { class: "ch-meta", title: chanLabel(rep) }, chanLabel(rep)) : null,
      group.some(isWholeForum) ? h("div", { class: "muted small" }, t("ch.forum_whole_hint")) : null,
      h("div", { class: "ch-meta" }, multi ? `${kindLabel(rep.kind)} · ${tn("ch.sources", group.length)}` : `${kindLabel(rep.kind)} · ${dstr || "—"} · ${t("common.minutes_short", { n: rep.poll_minutes })}`),
      h("div", { class: "ch-actions" },
        h("button", { class: "btn ghost sm", onClick: () => scanAll(group) }, h("span", { html: icon("scan") }), t("common.scan")),
        h("button", { class: "btn ghost sm", onClick: () => backfillAll(group) }, t("ch.backfill")),
        multi
          ? h("button", { class: "btn ghost sm", onClick: () => openChannelDrawer(ctx, rep, group) }, h("span", { html: icon("channels") }), t("ch.sources_btn"))
          : h("button", { class: "btn ghost sm icon", title: t("common.edit"), "aria-label": t("ch.edit_aria"), onClick: () => openChannelModal(ctx, rep) }, h("span", { html: icon("edit") })),
        multi ? null
          : h("button", { class: "btn ghost sm icon", title: t("common.remove"), "aria-label": t("ch.remove_aria"), onClick: async () => { if (confirm(t("ch.remove_confirm"))) { await api(`/api/channels/${rep.id}`, { method: "DELETE" }); toast(t("ch.removed"), "ok"); ctx.refresh(); } } }, h("span", { html: icon("trash") })))));
}

export function viewChannels(ctx) {
  const rows = ctx.data.channels || [];
  if (!rows.length) return emptyState("channels", t("ch.empty_title"), t("ch.empty_body"), t("shell.add_channel"), () => openChannelModal(ctx, null));
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
    meta.textContent = [a.year, kindLabel(c.kind), a.rating ? "★ " + a.rating : "", c.imdb_id || ""].filter(Boolean).join("  ·  ");
  };
  fill(art);
  if (!_artCache.has(c.imdb_id) && c.imdb_id) api(`/api/art?imdb=${encodeURIComponent(c.imdb_id)}`).then((a) => { _artCache.set(c.imdb_id, a || {}); fill(a || {}); });

  const onKey = (e) => { if (e.key === "Escape") close(); };
  const close = () => { document.removeEventListener("keydown", onKey); host.replaceChildren(); };
  document.addEventListener("keydown", onKey);
  const drawer = h("div", { class: "drawer", onClick: (e) => { if (e.target === drawer) close(); } },
    h("div", { class: "drawer-card" },
      h("div", { class: "hero-wrap" }, hero, h("div", { class: "hero-fade" }),
        h("button", { class: "btn ghost icon drawer-x", "aria-label": t("common.close"), onClick: close }, h("span", { html: icon("x") }))),
      h("div", { class: "drawer-body" },
        h("div", { class: "drawer-head" }, posterBox,
          h("div", { class: "drawer-info" },
            h("h2", {}, c.imdb_title || chanLabel(c)),
            grp.length === 1 && c.imdb_title && c.topic_title ? h("div", { class: "muted small" }, chanLabel(c)) : null,
            grp.length === 1 && isWholeForum(c) ? h("div", { class: "muted small" }, t("ch.forum_whole_hint")) : null,
            meta, overview,
            h("div", { class: "drawer-actions" },
              h("button", { class: "btn primary sm", onClick: () => scanAll(grp) }, h("span", { html: icon("scan") }), t("common.scan")),
              h("button", { class: "btn ghost sm", onClick: () => backfillAll(grp) }, t("ch.backfill")),
              grp.length === 1
                ? h("button", { class: "btn ghost sm", onClick: () => { close(); openChannelModal(ctx, c); } }, h("span", { html: icon("edit") }), t("common.edit"))
                : null))),
        grp.length > 1 ? h("div", { class: "drawer-eps" },
          h("div", { class: "card-h" }, tn("ch.source_channels", grp.length)),
          ...grp.map((s) => h("div", { class: "src-row" },
            h("span", { class: "dot " + (s.enabled ? "ok" : "bad") }),
            h("span", { class: "src-name", title: chanLabel(s) }, chanLabel(s)),
            isWholeForum(s) ? h("span", { class: "muted small", title: t("ch.forum_whole_hint") }, t("ch.forum_whole_short")) : null,
            h("button", { class: "btn ghost sm", onClick: async () => { await jpatch(`/api/channels/${s.id}`, { enabled: s.enabled ? 0 : 1 }); close(); ctx.refresh(); } }, s.enabled ? t("common.disable") : t("common.enable")),
            h("button", { class: "btn ghost sm", onClick: () => { close(); openChannelModal(ctx, s); } }, t("common.edit")),
            h("button", { class: "btn ghost sm icon", title: t("ch.remove_source"), "aria-label": t("ch.remove_source"), onClick: async () => { if (confirm(t("ch.remove_source_confirm"))) { await api(`/api/channels/${s.id}`, { method: "DELETE" }); toast(t("ch.source_removed"), "ok"); close(); ctx.refresh(); } } }, h("span", { html: icon("trash") }))))) : null,
        h("div", { class: "drawer-eps" },
          h("div", { class: "card-h" }, tn("ch.episodes_downloaded", eps.length)),
          ...(eps.length ? eps.slice(0, 60).map((d) => h("div", { class: "ep-row" },
            h("span", { class: "ep-name" }, base(d.save_path) || d.file_name),
            h("span", { class: "muted small" }, d.file_size ? gb(d.file_size) : "")))
            : [h("div", { class: "muted small pad" }, t("dash.no_downloads"))])))));
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
  || (dlSource(d) || "").toLowerCase().includes(ui.q.toLowerCase());

// Two-part episode resolution ("(2a Part)" published as the next TVDB episode).
const epTag = (n) => `E${String(n).padStart(2, "0")}`;
function episodeNote(d) {
  if (d.parsed_episode == null || !d.episode_source) return null;
  if (d.episode_source === "channel")
    return h("span", { class: "ep-note", title: t("ep.kept_title") },
      t("ep.kept", { ep: epTag(d.parsed_episode) }));
  const via = tOr(`ep.source.${d.episode_source}`, d.episode_source);
  const text = d.parsed_episode === d.episode ? t("ep.checked", { ep: epTag(d.episode), via })
    : t("ep.resolved", { from: epTag(d.parsed_episode), to: epTag(d.episode), via });
  return h("span", { class: "ep-note" }, text);
}

// Why a download failed, was cancelled or is held (keyed; legacy rows keep their text).
function errorNote(d) {
  const text = d.error_msg ? msg(d.error_msg) : d.error;
  return text ? h("span", { class: "err-note" }, text) : null;
}

function rowsTable(rows, ctx, selectAll = true) {
  const allSel = rows.length && rows.every((d) => ui.sel.has(d.id));
  const head = h("tr", {},
    h("th", { class: "cb" }, selectAll ? h("input", {
      type: "checkbox", checked: allSel, "aria-label": t("dl.select_all"),
      onChange: (e) => { rows.forEach((d) => e.target.checked ? ui.sel.add(d.id) : ui.sel.delete(d.id)); ctx.rerender(); },
    }) : null),
    ...["dl.col.file", "dl.col.channel", "dl.col.size", "dl.col.status", "dl.col.when"].map((k) => h("th", {}, t(k))), h("th", {}));
  const body = rows.map((d) => h("tr", { class: ui.sel.has(d.id) ? "selrow" : "" },
    h("td", { class: "cb" }, h("input", {
      type: "checkbox", checked: ui.sel.has(d.id), "aria-label": t("dl.select_row"),
      onChange: (e) => { e.target.checked ? ui.sel.add(d.id) : ui.sel.delete(d.id); ctx.rerender(); },
    })),
    h("td", { title: d.save_path }, base(d.save_path) || d.file_name, episodeNote(d), errorNote(d)),
    h("td", {}, dlSource(d) || "—"),
    h("td", {}, d.file_size ? gb(d.file_size) : "—"),
    h("td", {}, statusPill(d.status)),
    h("td", { class: "muted small" }, d.finished_at ? new Date(d.finished_at * 1000).toLocaleDateString(locale) : ""),
    h("td", { class: "actions" },
      (d.status === "failed" || d.status === "cancelled") ? h("button", { class: "btn ghost sm", onClick: async () => { await api(`/api/downloads/${d.id}/retry`, { method: "POST" }); toast(t("dl.requeued"), "ok"); ctx.refresh(); } }, t("dl.retry")) : null,
      h("button", { class: "btn ghost sm icon", title: t("common.delete"), "aria-label": t("dl.delete_record"), onClick: async () => { await api(`/api/downloads/${d.id}`, { method: "DELETE" }); ctx.refresh(); } }, h("span", { html: icon("trash") })))));
  return h("table", {}, h("thead", {}, head), h("tbody", {}, ...body));
}

// Group by the SHOW (its library folder), not the channel — so multiple source
// channels for one title collapse into a single group. Movies (no Season folder)
// fall back to the channel name.
function showOf(d) {
  const m = (d.save_path || "").match(/\/([^/]+)\/Season\s[^/]*\/[^/]*$/i);
  return m ? m[1] : (dlSource(d) || t("common.unknown"));
}
function completedGrouped(dls, ctx) {
  let rows = dls.filter((d) => d.status === "completed" && matchQ(d));
  if (ui.q) return rows.length ? h("div", { class: "data-card" }, rowsTable(sortRows(rows), ctx)) : h("div", { class: "empty" }, t("dl.no_matches"));
  if (!rows.length) return h("div", { class: "empty" }, t("dl.nothing_downloaded"));
  const groups = {};
  rows.forEach((d) => { const k = showOf(d); (groups[k] ||= []).push(d); });
  return h("div", { class: "stack" }, ...Object.keys(groups).sort().map((name) => {
    const items = sortRows(groups[name]); const size = items.reduce((s, d) => s + (d.file_size || 0), 0);
    const open = ui.expanded.has(name);
    const toggle = () => { open ? ui.expanded.delete(name) : ui.expanded.add(name); ctx.rerender(); };
    return h("div", { class: "grp" },
      h("div", {
        class: "grp-head", role: "button", tabindex: "0", "aria-expanded": open ? "true" : "false", "aria-label": t("dl.toggle_group", { name }),
        onClick: toggle, onKeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } },
      },
        h("span", { class: "tw", html: icon(open ? "chevron-down" : "chevron-right") }),
        h("span", { class: "grp-name" }, name),
        h("span", { class: "grp-meta" }, `${tn("dl.episodes", items.length)} · ${gb(size)}`),
        h("button", {
          class: "btn ghost sm", onClick: async (e) => {
            e.stopPropagation();
            const ids = items.map((d) => d.id);
            if (confirm(t("dl.clear_group_confirm", { n: ids.length, name }))) { await jpost("/api/downloads/bulk", { action: "delete", ids }); ctx.refresh(); }
          },
        }, t("common.clear"))),
      open ? h("div", { class: "grp-body" }, rowsTable(items, ctx, false)) : null);
  }));
}

export function viewDownloads(ctx) {
  const dls = ctx.data.downloads || []; const c = counts(dls);
  const tab = (k, label) => h("button", { class: `tab ${ui.tab === k ? "on" : ""}`, onClick: () => { ui.tab = k; ctx.rerender(); } }, label, h("b", {}, c[k] || 0));
  const controls = h("div", { class: "dl-controls" },
    h("div", { class: "tabs" }, tab("completed", t("dash.stat.completed")), tab("failed", t("dash.stat.failed")), tab("cancelled", t("dl.cancelled"))),
    h("input", { id: "dl-search", type: "search", placeholder: t("dl.filter"), value: ui.q, onInput: (e) => { ui.q = e.target.value; ctx.rerender(); } }),
    h("select", { class: "mini", title: t("dl.sort"), onChange: (e) => { ui.sort = e.target.value; localStorage.setItem("dl_sort", ui.sort); ctx.rerender(); } },
      ...[["new", t("dl.sort.new")], ["old", t("dl.sort.old")], ["big", t("dl.sort.big")], ["name", t("dl.sort.name")]].map(([v, l]) => h("option", { value: v, selected: ui.sort === v }, l))),
    h("button", { class: "btn ghost sm icon", title: t("dl.density"), "aria-label": t("dl.density_aria"), onClick: () => { ui.dense = !ui.dense; localStorage.setItem("density", ui.dense ? "1" : "0"); document.body.classList.toggle("dense", ui.dense); ctx.rerender(); } }, h("span", { html: icon("filter") })));

  // bulk bar
  const sel = dls.filter((d) => ui.sel.has(d.id));
  const bulk = h("div", { class: "bulk-bar" });
  if (ui.sel.size) {
    bulk.append(h("span", {}, h("b", {}, ui.sel.size), " " + t("dl.selected")));
    if (sel.some(isRetryable))
      bulk.append(h("button", { class: "btn ghost sm", onClick: async () => { await jpost("/api/downloads/bulk", { action: "retry", ids: retryableIds(sel) }); ui.sel.clear(); ctx.refresh(); } }, t("dl.retry")));
    bulk.append(h("button", { class: "btn danger sm", onClick: async () => { await jpost("/api/downloads/bulk", { action: "delete", ids: [...ui.sel] }); ui.sel.clear(); ctx.refresh(); } }, t("common.delete")));
    bulk.append(h("button", { class: "btn ghost sm", onClick: () => { ui.sel.clear(); ctx.rerender(); } }, t("dl.clear_selection")));
  }
  bulk.append(h("span", { class: "spacer" }));
  if (c.failed) bulk.append(h("button", { class: "btn ghost sm", onClick: async () => { const ids = dls.filter((d) => d.status === "failed").map((d) => d.id); if (confirm(t("dl.delete_failed_confirm", { n: ids.length }))) { await jpost("/api/downloads/bulk", { action: "delete", ids }); ctx.refresh(); } } }, t("dl.clear_failed", { n: c.failed })));

  const body = ui.tab === "completed" ? completedGrouped(dls, ctx)
    : (() => { const rows = dls.filter((d) => d.status === ui.tab && matchQ(d)); return rows.length ? h("div", { class: "data-card" }, rowsTable(sortRows(rows), ctx)) : h("div", { class: "empty" }, t("dl.nothing_here")); })();

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
    h("span", { class: "lg-msg" }, l.text,
      l.count > 1 ? h("span", { class: "lg-count", title: t("log.times", { n: l.count }) }, "×" + l.count) : null),
    h("span", { class: "lg-time mono", title: fmtDateTime(new Date(l.ts * 1000)) }, fmtWhen(l.ts)));
}
export function viewActivity(ctx) {
  const list = h("div", { class: "log-list", id: "log-list" }, h("div", { class: "empty" }, t("common.loading")));
  const lvlSel = h("select", { class: "mini", onChange: () => load() },
    ...[["", t("log.all_levels")], ["ERROR", t("log.errors")], ["WARN", t("log.warnings")], ["INFO", t("log.info")]].map(([v, l]) => h("option", { value: v }, l)));
  const search = h("input", { class: "mini", type: "search", placeholder: t("log.search"), oninput: () => load() });
  async function load() {
    const rows = await api("/api/logs?limit=500"); if (!rows) return;
    const lvl = lvlSel.value, q = search.value.trim().toLowerCase();
    // Keyed rows show in the UI language; rows from older versions keep their stored text.
    const texts = rows.map((l) => ({ ...l, text: l.msg ? msg(l.msg) : l.message }));
    const filtered = texts.filter((l) => (!lvl || l.level === lvl) && (!q || l.text.toLowerCase().includes(q)));
    // Collapse consecutive identical entries into one row with a ×N count —
    // otherwise a repeating error (e.g. every 30s) buries everything else.
    const grouped = [];
    for (const l of filtered) {
      const last = grouped[grouped.length - 1];
      if (last && last.level === l.level && last.text === l.text) { last.count++; last.ts = Math.max(last.ts, l.ts); }
      else grouped.push({ ...l, count: 1 });
    }
    mount(list, grouped.length
      ? h("div", {}, ...grouped.map(logRow))
      : h("div", { class: "empty" }, t("log.none")));
  }
  load();
  const refresh = h("button", { class: "btn ghost sm", onClick: () => load() }, h("span", { html: icon("refresh") }), t("common.refresh"));
  return h("div", { class: "stack" },
    h("div", { class: "log-toolbar" }, lvlSel, search, h("span", { class: "spacer", style: "flex:1" }), refresh),
    list);
}

export function fmtWhen(ts) {
  if (!ts) return "—";
  const diff = Date.now() / 1000 - ts;
  if (diff < 0) {
    const s = -diff;
    if (s < 60) return t("when.in_lt_minute");
    if (s < 3600) return t("when.in_m", { n: Math.round(s / 60) });
    if (s < 86400) return t("when.in_h", { n: Math.round(s / 3600) });
    return fmtDateTime(new Date(ts * 1000));
  }
  if (diff < 60) return t("when.just_now");
  if (diff < 3600) return t("when.m_ago", { n: Math.round(diff / 60) });
  if (diff < 86400) return t("when.h_ago", { n: Math.round(diff / 3600) });
  return new Date(ts * 1000).toLocaleDateString(locale);
}

// ── Settings ──
export function viewSettings(ctx) {
  const root = h("div", { class: "stack settings-wrap" }, h("div", { class: "empty" }, t("common.loading")));
  (async () => {
    const data = await api("/api/settings"); if (!data) return;
    const s = data.settings, p = data.paths, arrKey = (data.arr || {}).apikey || "";
    const row = (label, input, hint) => h("div", { class: "set-row" },
      h("label", {}, label, hint && h("div", { class: "hint" }, hint)), input);
    const inp = (id, val, type = "text") => h("input", { id, value: val ?? "", type });

    const account = card(t("set.account"),
      row(t("login.username"), inp("acct-username", data.user || ""), t("set.username_hint")),
      row(t("set.confirm_password"), inp("uname-cur", "", "password"), t("set.confirm_password_hint")),
      h("div", { class: "set-actions" },
        h("button", { class: "btn primary sm", onClick: async () => {
          const r = await jpost("/api/account/username", { username: root.querySelector("#acct-username").value, current: root.querySelector("#uname-cur").value });
          if (r) { toast(t("set.username_changed", { username: r.username }), "ok"); ctx.rerender(); }
        } }, t("set.change_username"))),
      h("div", { class: "card-h", style: "margin-top:20px" }, t("login.password")),
      row(t("set.current_password"), inp("pw-cur", "", "password")),
      row(t("set.new_password"), inp("pw-new", "", "password"), t("set.new_password_hint", { min: 12 })),
      h("div", { class: "set-actions" },
        h("button", { class: "btn primary sm", onClick: async () => { const r = await jpost("/api/account/password", { current: root.querySelector("#pw-cur").value, new: root.querySelector("#pw-new").value }); if (r) { toast(t("set.password_changed"), "ok"); root.querySelector("#pw-cur").value = ""; root.querySelector("#pw-new").value = ""; } } }, t("set.change_password")),
        h("a", { class: "btn ghost sm", href: "/logout" }, h("span", { html: icon("logout") }), t("shell.sign_out"))));

    const themeBtn = (v, l) => h("button", { class: `btn ghost sm ${ctx.getTheme() === v ? "on" : ""}`, onClick: () => { ctx.setTheme(v); ctx.rerender(); } }, l);
    const langSel = h("select", { id: "set-ui_lang", onChange: async (e) => {
      if (await jpatch("/api/settings", { ui_lang: e.target.value })) location.reload();
    } }, ...[["ca", "Català"], ["en", "English"]].map(([v, l]) => h("option", { value: v, selected: lang === v }, l)));
    const appearance = card(t("set.appearance"),
      row(t("set.language"), langSel, t("set.language_hint")),
      row(t("shell.theme"), h("div", { class: "theme-pick" }, themeBtn("auto", t("set.theme.auto")), themeBtn("light", t("set.theme.light")), themeBtn("dark", t("set.theme.dark")))));

    const perf = card(t("set.performance"),
      row(t("set.dl_workers"), inp("set-dl_workers", s.dl_workers, "number"), t("set.dl_workers_hint")),
      row(t("set.max_concurrent"), inp("set-max_concurrent", s.max_concurrent, "number")),
      row(t("set.min_free_gb"), inp("set-min_free_gb", s.min_free_gb, "number")),
      row(t("set.default_poll"), inp("set-default_poll_minutes", s.default_poll_minutes, "number"), t("set.default_poll_hint", { floor: s.poll_floor_minutes })),
      row(t("set.daily_budget"), inp("set-daily_budget_gb", s.daily_budget_gb, "number"), t("set.daily_budget_hint")),
      row(t("set.history_limit"), inp("set-history_limit_per_show", s.history_limit_per_show, "number"), t("set.history_limit_hint")),
      h("div", { class: "set-actions" }, h("button", {
        class: "btn primary sm", onClick: async () => {
          const g = (k) => root.querySelector("#set-" + k).value;
          const r = await jpatch("/api/settings", { dl_workers: g("dl_workers"), max_concurrent: g("max_concurrent"), min_free_gb: g("min_free_gb"), default_poll_minutes: g("default_poll_minutes"), daily_budget_gb: g("daily_budget_gb"), history_limit_per_show: g("history_limit_per_show") });
          if (r) toast(t("set.performance_saved"), "ok");
        },
      }, t("set.save_performance"))));

    const plexOut = h("span", { class: "test-out" });
    const plex = card("Plex",
      row(t("set.plex_url"), inp("set-plex_url", s.plex_url), t("common.example", { value: "http://plex_local:32400" })),
      row(t("set.plex_token") + (s.plex_token_set ? ` ${t("common.saved_suffix")}` : ""), inp("set-plex_token", "", "password")),
      h("div", { class: "set-actions" },
        h("button", { class: "btn primary sm", onClick: async () => { const f = { plex_url: root.querySelector("#set-plex_url").value }; const tk = root.querySelector("#set-plex_token").value; if (tk) f.plex_token = tk; await jpatch("/api/settings", f); toast(t("set.plex_saved"), "ok"); } }, t("common.save")),
        h("button", { class: "btn ghost sm", onClick: async () => { const r = await api("/api/integrations/plex/test", { method: "POST" }); if (r) { plexOut.textContent = msg(r.detail); plexOut.style.color = `var(--${r.ok ? "ok" : "err"})`; } } }, t("common.test")), plexOut));

    const notifyOut = h("span", { class: "test-out" });
    const tgChk = h("input", { type: "checkbox", id: "set-notify_telegram",
      onChange: async (e) => { await jpatch("/api/settings", { notify_telegram: e.target.checked }); toast(e.target.checked ? t("set.tg_dm_on") : t("set.tg_dm_off"), "ok"); } });
    if (s.notify_telegram) tgChk.checked = true;
    const notify = card(t("set.notifications"),
      row(h("span", {}, t("notify.test.saved_messages")), h("div", { class: "chkwrap" }, tgChk), t("set.tg_dm_hint")),
      row(t("set.webhook_url"), inp("set-notify_webhook", s.notify_webhook), t("set.webhook_hint")),
      h("div", { class: "set-actions" },
        h("button", { class: "btn primary sm", onClick: async () => { await jpatch("/api/settings", { notify_webhook: root.querySelector("#set-notify_webhook").value }); toast(t("set.webhook_saved"), "ok"); } }, t("set.save_webhook")),
        h("button", { class: "btn ghost sm", onClick: async () => { notifyOut.textContent = t("set.sending"); notifyOut.style.color = "var(--muted)"; const r = await api("/api/integrations/notify/test", { method: "POST" }); if (r) { notifyOut.textContent = msg(r.detail); notifyOut.style.color = `var(--${r.ok ? "ok" : "err"})`; } } }, t("set.send_test")), notifyOut));

    const tmdbOut = h("span", { class: "test-out" });
    const tmdbc = card(t("set.tmdb"),
      h("div", { class: "muted small", style: "margin-bottom:10px" }, t("set.tmdb_intro")),
      row(t("common.api_key") + (s.tmdb_key_set ? ` ${t("common.saved_suffix")}` : ""), inp("set-tmdb_key", "", "password")),
      h("div", { class: "set-actions" },
        h("button", { class: "btn primary sm", onClick: async () => { const tk = root.querySelector("#set-tmdb_key").value; if (tk) await jpatch("/api/settings", { tmdb_key: tk }); toast(t("set.tmdb_saved"), "ok"); } }, t("common.save")),
        h("button", { class: "btn ghost sm", onClick: async () => { tmdbOut.textContent = t("common.testing"); tmdbOut.style.color = "var(--muted)"; const r = await jpost("/api/integrations/tmdb/test", { key: root.querySelector("#set-tmdb_key").value }); if (r) { tmdbOut.textContent = msg(r.detail); tmdbOut.style.color = `var(--${r.ok ? "ok" : "err"})`; } } }, t("common.test")), tmdbOut),
      h("div", { class: "muted small", style: "margin-top:10px" }, t("set.tmdb_attribution")));

    const keyInp = inp("arr-key", arrKey); keyInp.readOnly = true;
    const nzInp = inp("arr-nzb", `${location.origin}/api/newznab`); nzInp.readOnly = true;
    const standaloneChk = h("input", { type: "checkbox", id: "set-operating_mode",
      onChange: async (e) => { await jpatch("/api/settings", { operating_mode: e.target.checked ? "standalone" : "arr" }); toast(e.target.checked ? t("set.standalone_on") : t("set.arr_mode_on"), "ok"); } });
    if (s.operating_mode === "standalone") standaloneChk.checked = true;
    const arr = card(t("set.arr"),
      h("div", { class: "muted small", style: "margin-bottom:10px" }, t("set.arr_intro")),
      h("div", { class: "set-actions", style: "margin-bottom:10px" },
        h("a", { class: "btn primary sm", href: "#/connect" }, h("span", { html: icon("link") }), t("set.arr_open_connect"))),
      row(t("set.newznab_url"), nzInp),
      row(t("set.sab_host"), (() => { const i = inp("arr-sab", `${location.hostname} : ${location.port || 8790}`); i.readOnly = true; return i; })()),
      row(t("common.api_key"), keyInp),
      h("div", { class: "set-actions" },
        h("button", { class: "btn ghost sm", onClick: () => copy(nzInp.value) }, h("span", { html: icon("copy") }), t("set.copy_url")),
        h("button", { class: "btn ghost sm", onClick: () => copy(keyInp.value) }, h("span", { html: icon("copy") }), t("set.copy_key")),
        h("button", { class: "btn ghost sm", onClick: async () => { const r = await jpost("/api/integrations/arr/regenerate", {}); if (r) { keyInp.value = r.apikey; toast(t("set.key_regenerated"), "ok"); } } }, h("span", { html: icon("refresh") }), t("set.regenerate_key"))),
      row(t("set.downloads_dir"), inp("set-downloads_dir", s.downloads_dir), t("set.downloads_dir_hint")),
      row(t("set.standalone"), standaloneChk, t("set.standalone_hint")),
      h("div", { class: "set-actions" },
        h("button", { class: "btn primary sm", onClick: async () => { const r = await jpatch("/api/settings", { downloads_dir: root.querySelector("#set-downloads_dir").value }); if (r) { root.querySelector("#set-downloads_dir").value = r.settings.downloads_dir; toast(t("set.downloads_dir_saved"), "ok"); } } }, t("set.save_folder"))));

    const paths = card(t("set.paths"),
      h("div", { class: "muted small" }, h("div", {}, `${t("set.paths.tv")} → ${p.tv_dir}`), h("div", {}, `${t("set.paths.tv_4k")} → ${p.tv_dir_4k}`), h("div", {}, `${t("set.paths.movies")} → ${p.movies_dir}`), h("div", {}, `${t("set.paths.other")} → ${p.other_dir}`), h("div", { style: "margin-top:6px" }, t("set.paths_hint"))));

    const tgAuth = (await api("/api/telegram/auth")) || {};
    const tgCard = card(t("set.tg_account"),
      h("div", { class: "muted small", style: "margin-bottom:10px" }, tgAuth.authorized
        ? t("set.tg_connected")
        : t("set.tg_not_connected")),
      h("div", { class: "set-actions" }, tgAuth.authorized
        ? h("button", { class: "btn ghost sm", onClick: async () => { if (confirm(t("set.tg_disconnect_confirm"))) { await api("/api/telegram/auth/logout", { method: "POST" }); toast(t("set.tg_disconnected"), "ok"); ctx.rerender(); } } }, t("set.tg_disconnect"))
        : h("button", { class: "btn primary sm", onClick: () => openTelegramConnect(ctx) }, h("span", { html: icon("telegram") }), t("banner.connect_telegram"))));

    const proxyOut = h("span", { class: "test-out" });
    const proxyInp = inp("set-proxy", "", "text");
    proxyInp.placeholder = s.proxy_set ? t("set.proxy_set_placeholder") : "socks5://user:pass@host:port";
    const proxyc = card(t("set.proxy"),
      h("div", { class: "muted small", style: "margin-bottom:10px" }, t("set.proxy_intro")),
      row(t("set.proxy_url") + (s.proxy_set ? ` ${t("set.proxy_set_suffix")}` : ""), proxyInp),
      h("div", { class: "set-actions" },
        h("button", { class: "btn primary sm", onClick: async () => {
          proxyOut.textContent = t("set.proxy_connecting"); proxyOut.style.color = "var(--muted)";
          const r = await jpost("/api/telegram/proxy", { proxy: proxyInp.value });
          if (r) { const ok = !r.error; proxyOut.textContent = ok ? t("set.proxy_connected", { via: r.proxy || t("set.proxy_direct") }) : msg(r.error); proxyOut.style.color = `var(--${ok ? "ok" : "err"})`; if (ok) proxyInp.value = ""; }
        } }, t("common.save_test")),
        s.proxy_set ? h("button", { class: "btn ghost sm", onClick: async () => { const r = await jpost("/api/telegram/proxy", { proxy: "" }); if (r && !r.error) { toast(t("set.proxy_cleared"), "ok"); ctx.rerender(); } } }, t("common.clear")) : null,
        proxyOut));

    // Grouped into tabs (was one long column). Cards are built once; switching
    // tabs just re-parents them, so unsaved input and handlers survive.
    const TABS = [
      ["account", t("set.account"), [account, appearance]],
      ["downloads", t("nav.downloads"), [perf, paths]],
      ["integrations", t("set.integrations"), [tgCard, proxyc, plex, tmdbc, notify, arr]],
    ];
    const tabsRow = h("div", { class: "tabs" });
    const body = h("div", { class: "settings-cols" });
    const renderTab = () => {
      const cur = TABS.some((tab) => tab[0] === ui.setTab) ? ui.setTab : "account";
      mount(tabsRow, ...TABS.map(([k, label]) =>
        h("button", { class: "tab " + (cur === k ? "on" : ""), onClick: () => { ui.setTab = k; renderTab(); } }, label)));
      mount(body, ...TABS.find((tab) => tab[0] === cur)[2]);
    };
    renderTab();
    root.replaceChildren(tabsRow, body);
  })();
  return root;
}

// ── Channel modal (add / edit) with IMDb picker ──
// ── Telegram connect wizard ──
const POLL_FLOOR_MIN = 15;   // account safety: mirrors config.POLL_FLOOR_MINUTES (server enforces it)

const CHANNEL_KINDS = [["tv", t("chm.kind.tv")], ["movie", t("chm.kind.movie")]];
const SEARCH_DEBOUNCE_MS = 350;

const idsLine = (c) => [c.tvdb_id && `TVDB ${c.tvdb_id}`, c.tmdb_id && `TMDB ${c.tmdb_id}`, c.imdb_id && `IMDb ${c.imdb_id}`].filter(Boolean).join(" · ");

/** Series identity block of the channel dialog: TMDB search (Catalan titles,
 * English fallback server-side) + editable TVDB id. Mapping is saved via
 * PUT /api/channels/{id}/series, which derives the TMDB/IMDb ids. */
function seriesMapper(channel) {
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
  const search = async (q) => {
    if (!q || q.length < 2) return results.replaceChildren();
    const res = await api(`/api/tmdb/search?q=${encodeURIComponent(q)}`); if (!res) return;
    if (!res.length) return mount(results, h("div", { class: "muted small pad" }, t("chm.no_series")));
    results.replaceChildren(...res.map((r) => h("button", { type: "button", class: "hit", onClick: () => choose(r) },
      r.title, h("small", {}, ` ${r.year ? `(${r.year})` : ""}${r.original_title && r.original_title !== r.title ? ` · ${r.original_title}` : ""}`))));
  };
  query.addEventListener("input", () => { clearTimeout(timer); const q = query.value; timer = setTimeout(() => search(q), SEARCH_DEBOUNCE_MS); });
  api("/api/settings").then((s) => {
    if (s && !s.settings.tmdb_key_set) keyNote.textContent = t("chm.tmdb_key_required");
  });
  const node = h("div", { class: "series-map" },
    keyNote,
    h("label", {}, t("chm.series"), query), results,
    h("label", {}, t("chm.tvdb_id"), tvdb), picked);
  return {
    node,
    searchFor: (title) => { if (!query.value && title) { query.value = title; search(title); } },
    // Payload for PUT /api/channels/{id}/series, or null when nothing changed.
    payload: () => {
      const typed = tvdb.value.trim();
      if (!pick && !(tvdbEdited && typed)) return null;
      return { tmdb_id: pick ? pick.tmdb_id : null, tvdb_id: tvdbEdited ? typed : null, title: pick ? pick.title : "" };
    },
  };
}

export function openChannelModal(ctx, channel) {
  const host = document.querySelector("#modal-root");
  let selected = channel ? { chat_id: channel.chat_id, title: channel.imdb_title || channel.title } : null;
  const kinds = CHANNEL_KINDS.some(([k]) => channel && channel.kind === k) || !channel ? CHANNEL_KINDS : [...CHANNEL_KINDS, [channel.kind, kindLabel(channel.kind)]];
  const kind = h("select", {}, ...kinds.map(([k, label]) => h("option", { value: k, selected: channel && channel.kind === k }, label)));
  const curLang = (channel && channel.language) || "cat";
  const language = h("select", {}, ...[["cat", `${t("chm.lang.cat")} (CAT)`], ["es", `${t("chm.lang.es")} (SPA)`], ["en", `${t("chm.lang.en")} (ENG)`], ["multi", `${t("chm.lang.multi")} (MULTI)`]]
    .map(([v, label]) => h("option", { value: v, selected: curLang === v }, label)));
  const curQuality = (channel && channel.fallback_quality) || "1080p";
  const fallbackQuality = h("select", {}, ...[["SDTV", "SDTV"], ["720p", "720p"], ["1080p", "1080p"], ["2160p", "2160p (4K)"]]
    .map(([v, label]) => h("option", { value: v, selected: curQuality === v }, label)));
  const poll = h("input", { type: "number", min: String(POLL_FLOOR_MIN), value: channel ? Math.max(POLL_FLOOR_MIN, channel.poll_minutes) : POLL_FLOOR_MIN });
  const daysOn = channel ? (channel.weekdays || "").split(",") : ["0", "1", "2", "3", "4", "5", "6"];
  const dayBtns = WEEKDAYS.map((d, i) =>
    h("button", { type: "button", class: `m-day ${daysOn.includes(String(i)) ? "on" : ""}`, dataset: { day: i }, onClick: (e) => e.target.classList.toggle("on") }, d));
  const series = seriesMapper(channel);
  const movieNote = h("div", { class: "muted small" }, t("chm.movie_note"));
  const identity = h("div", {});
  const showIdentity = () => mount(identity, kind.value === "tv" ? series.node : movieNote);
  kind.addEventListener("change", showIdentity);
  showIdentity();
  const kindRow = h("label", {}, t("chm.kind"), kind);

  // forum topics: a forum group gets one source per ticked topic (channel-topics.js)
  const topics = channelTopics({ kinds: CHANNEL_KINDS, kindRow, identity, series, showIdentity });

  // ── channel selection ──
  let chanArea;
  if (channel) {
    chanArea = h("label", {}, t("chm.tg_channel"), h("input", { value: `${channel.imdb_title || chanLabel(channel)} (${channel.chat_id})`, disabled: true }));
  } else {
    const chanQ = h("input", { placeholder: t("chm.chan_search_placeholder"), autocomplete: "off" });
    const chanList = h("div", { class: "chan-list" }, h("div", { class: "muted small pad" }, t("chm.loading_chats")));
    const chanSel = h("div", { class: "chan-selected" });
    let dialogs = [];
    const showSel = () => mount(chanSel, selected
      ? h("div", { class: "chip" }, h("span", { html: icon("check") }), h("span", {}, `${selected.title} · ${selected.chat_id}`)) : []);
    const selectChan = (d) => { selected = { chat_id: d.chat_id, title: d.title }; showSel(); renderList(); series.searchFor(d.title); topics.load(d.chat_id); };
    const resolveChan = async () => {
      mount(chanList, h("div", { class: "muted small pad" }, t("chm.resolving")));
      const r = await jpost("/api/telegram/resolve", { query: chanQ.value.trim() });
      if (r && r.chat_id) { selectChan(r); toast(t("chm.resolved") + (r.username ? " @" + r.username : ""), "ok"); }
      else { toast(msg(r && r.error) || t("chm.resolve_failed"), "err"); renderList(); }
    };
    const renderList = () => {
      const q = chanQ.value.trim();
      const ql = q.toLowerCase();
      const items = dialogs.filter((d) => !ql || (d.title + " " + d.username).toLowerCase().includes(ql));
      const nodes = [];
      if (/t\.me\/|joinchat|^@|^\+|^https?:/i.test(q))
        nodes.push(h("button", { type: "button", class: "chan-item resolve", onclick: resolveChan }, h("span", { class: "ci-ic", html: icon("link") }), h("span", {}, t("chm.resolve", { query: q }))));
      nodes.push(...items.slice(0, 80).map((d) => h("button", { type: "button", class: "chan-item" + (selected && String(selected.chat_id) === String(d.chat_id) ? " on" : ""), onclick: () => selectChan(d) },
        h("span", { class: "ci-ic", html: icon(d.kind === "channel" ? "channels" : "folder") }),
        h("span", { class: "ci-main" }, h("span", { class: "ci-title" }, d.title), h("span", { class: "ci-sub" }, (d.username ? "@" + d.username + " · " : "") + tOr(`chm.dialog.${d.kind}`, d.kind))))));
      if (!nodes.length) nodes.push(h("div", { class: "muted small pad" }, dialogs.length ? t("chm.no_matches") : t("chm.no_channels")));
      mount(chanList, ...nodes);
    };
    chanQ.addEventListener("input", renderList);
    api("/api/telegram/dialogs").then((d) => { dialogs = d || []; if (!dialogs.length) mount(chanList, h("div", { class: "muted small pad" }, t("chm.no_chats"))); else renderList(); });
    chanArea = h("div", {}, h("label", {}, t("chm.tg_channel"), chanQ, chanList, chanSel), topics.node);
  }

  const onKey = (e) => { if (e.key === "Escape") close(); };
  const close = () => { document.removeEventListener("keydown", onKey); host.replaceChildren(); };
  document.addEventListener("keydown", onKey);
  // a failed topic source keeps the dialog open (api() has shown why)
  const addTopicSources = async (fields) => {
    const res = await topics.addSources(selected.chat_id, fields);
    if (!res) return;
    if (res.all) close();
    ctx.refresh();
  };
  const save = async () => {
    const weekdays = dayBtns.filter((b) => b.classList.contains("on")).map((b) => b.dataset.day).join(",") || "0,1,2,3,4,5,6";
    const pm = parseInt(poll.value) || POLL_FLOOR_MIN;
    if (!channel && !selected) return toast(t("chm.pick_first"), "err");
    const fields = { kind: kind.value, weekdays, poll_minutes: pm, language: language.value, fallback_quality: fallbackQuality.value };
    if (!channel && (await topics.isForum())) return addTopicSources(fields);
    const ch = channel
      ? await jpatch(`/api/channels/${channel.id}`, fields)
      : await jpost("/api/channels", { chat_id: selected.chat_id, ...fields });
    if (!ch) return;
    const mapping = kind.value === "tv" ? series.payload() : null;
    // a failed mapping keeps the dialog open; api() has already shown the reason
    if (mapping && !(await jput(`/api/channels/${ch.id}/series`, mapping))) { ctx.refresh(); return; }
    toast(channel ? t("chm.updated") : t("chm.added"), "ok");
    close(); ctx.refresh();
  };

  const overlay = h("div", { class: "modal", onClick: (e) => { if (e.target === overlay) close(); } },
    h("div", { class: "modal-card" },
      h("div", { class: "modal-head" }, h("h3", {}, channel ? t("ch.edit_aria") : t("shell.add_channel")),
        h("button", { class: "btn ghost icon", "aria-label": t("common.close"), onClick: close }, h("span", { html: icon("x") }))),
      chanArea,
      kindRow,
      h("label", {}, t("chm.audio_language"), language),
      h("label", {}, t("chm.fallback_quality"), fallbackQuality),
      h("label", {}, t("chm.scan_days")), h("div", { class: "days" }, ...dayBtns),
      h("label", {}, t("chm.poll"), poll),
      identity,
      h("div", { class: "modal-foot" },
        h("button", { class: "btn ghost", onClick: close }, t("common.cancel")),
        h("button", { class: "btn primary", onClick: save }, t("common.save")))));
  host.replaceChildren(overlay);
}
