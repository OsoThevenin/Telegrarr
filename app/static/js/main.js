// main.js — app bootstrap: shell, router, polling, theme.
import { h, mount, qs, api } from "./core.js";
import { icon } from "./icons.js";
import { viewDashboard, viewChannels, viewDownloads, viewActivity, viewSystem, viewSettings, openChannelModal, openTelegramConnect, liveActive, liveDashboard, ui } from "./views.js";
import { initPalette, openCommandPalette } from "./palette.js";

const NAV = [
  { id: "dashboard", label: "Dashboard", icon: "dashboard", view: viewDashboard },
  { id: "channels", label: "Channels", icon: "channels", view: viewChannels },
  { id: "downloads", label: "Downloads", icon: "downloads", view: viewDownloads },
  { id: "activity", label: "Activity", icon: "activity", view: viewActivity },
  { id: "system", label: "System", icon: "system", view: viewSystem },
  { id: "settings", label: "Settings", icon: "settings", view: viewSettings },
];
const TITLE = Object.fromEntries(NAV.map((n) => [n.id, n.label]));
const LOGO = '<svg viewBox="0 0 64 64" width="27" height="27" aria-hidden="true">'
  + '<rect width="64" height="64" rx="14" fill="#0071e3"/>'
  + '<g fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round">'
  + '<path d="M32 15 V35"/><path d="M23 27 L32 36 L41 27"/>'
  + '<path d="M17 40 V45 A4 4 0 0 0 21 49 H43 A4 4 0 0 0 47 45 V40"/></g></svg>';

let DATA = { status: null, downloads: [], channels: [] };
let active = (location.hash.replace("#/", "") || "dashboard");
if (!TITLE[active]) active = "dashboard";

// ── theme ──
function applyTheme(t) {
  if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
  else document.documentElement.removeAttribute("data-theme");
}
const getTheme = () => localStorage.getItem("theme") || "auto";
function setTheme(t) { localStorage.setItem("theme", t); applyTheme(t); syncThemeBtn(); }
function cycleTheme() { const order = ["auto", "light", "dark"]; setTheme(order[(order.indexOf(getTheme()) + 1) % 3]); }
applyTheme(getTheme());
if (ui.dense) document.body.classList.add("dense");

const ctx = {
  get data() { return DATA; },
  refresh: async () => { await fetchForView(); render(); },
  rerender: () => render(),
  getTheme, setTheme,
};

// ── shell ──
function buildShell() {
  const brand = h("div", { class: "brand" }, h("span", { class: "logo", html: LOGO }), h("span", {}, "Telegr", h("b", {}, "arr")));
  const navBtn = (n, cls) => h("button", { class: `${cls} ${active === n.id ? "on" : ""}`, dataset: { view: n.id }, onClick: () => go(n.id) },
    h("span", { class: "ni", html: icon(n.icon) }), h("span", { class: "nl" }, n.label));
  const sidebar = h("aside", { class: "sidebar" },
    brand,
    h("nav", { class: "nav" }, ...NAV.map((n) => navBtn(n, "nav-item"))),
    h("div", { class: "side-foot" },
      h("div", { id: "tg-status", class: "tg-status" }, "…"),
      h("button", { id: "pause-toggle", class: "btn ghost block", onClick: togglePause }, "…"),
      h("a", { class: "logout", href: "/logout" }, "Sign out")));
  const topbar = h("header", { class: "topbar" },
    h("h1", { id: "view-title" }, TITLE[active]),
    h("span", { id: "tg-dot", class: "dot", title: "Telegram" }),
    h("div", { class: "topbar-actions" },
      h("button", { class: "btn ghost cmdk-btn", title: "Command palette", "aria-label": "Open command palette (Ctrl/Cmd K)", onClick: openCommandPalette }, h("span", { html: icon("search") }), h("kbd", {}, "⌘K")),
      h("button", { id: "theme-toggle", class: "btn ghost icon", title: "Theme", "aria-label": "Toggle theme (auto/light/dark)", onClick: cycleTheme }, h("span", { html: icon("sun") })),
      h("div", { id: "ctx-actions" })));
  // Mobile bottom nav is capped at 5 (iOS/Android guidance). Activity stays in
  // the desktop sidebar and the ⌘K palette.
  const BOTTOM_NAV = NAV.filter((n) => n.id !== "activity");
  const bottomNav = h("nav", { class: "bottom-nav" }, ...BOTTOM_NAV.map((n) => navBtn(n, "bnav-item")));
  const banner = h("div", { id: "tg-banner", class: "tg-banner", hidden: true },
    h("span", {}, h("span", { class: "tgb-ic", html: icon("alert") }), " Telegram isn’t connected — Telegrarr can’t download until you sign in."),
    h("button", { class: "btn primary sm", onClick: () => openTelegramConnect(ctx) }, "Connect Telegram"));
  // account safety: shown while the daily download budget is used up
  const budgetBanner = h("div", { id: "budget-banner", class: "tg-banner", hidden: true },
    h("span", {}, h("span", { class: "tgb-ic", html: icon("alert") }), h("span", { id: "budget-text" })));
  mount(qs("#app"),
    sidebar,
    h("main", { class: "main" }, topbar, banner, budgetBanner, h("div", { class: "view", id: "view-root" })),
    bottomNav);
}

function syncNav() {
  document.querySelectorAll(".nav-item,.bnav-item").forEach((b) => b.classList.toggle("on", b.dataset.view === active));
  const t = qs("#view-title"); if (t) t.textContent = TITLE[active];
  document.title = active === "dashboard" ? "Telegrarr" : `${TITLE[active]} · Telegrarr`;
  const ca = qs("#ctx-actions");
  if (ca) mount(ca, active === "channels"
    ? h("button", { class: "btn primary", onClick: () => openChannelModal(ctx, null) }, h("span", { html: icon("plus") }), "Add channel")
    : []);
}
function syncThemeBtn() { const b = qs("#theme-toggle"); if (b) mount(b, h("span", { html: icon(getTheme() === "dark" ? "moon" : getTheme() === "light" ? "sun" : "wifi") })); }

function updateShell() {
  const s = DATA.status; if (!s) return;
  const dot = qs("#tg-dot"); if (dot) { dot.className = "dot " + (s.authorized ? "ok" : "bad"); dot.title = s.authorized ? "Telegram connected" : "Telegram offline"; }
  const tg = qs("#tg-status"); if (tg) mount(tg, h("span", { class: "dot " + (s.authorized ? "ok" : "bad") }), s.authorized ? "Telegram connected" : "Telegram offline");
  const pt = qs("#pause-toggle"); if (pt) mount(pt, h("span", { html: icon(s.paused ? "play" : "pause") }), s.paused ? "Resume downloads" : "Pause downloads");
  const banner = qs("#tg-banner"); if (banner) banner.hidden = s.authorized !== false;
  const bb = qs("#budget-banner"), b = s.budget;
  if (bb) {
    bb.hidden = !(b && b.exhausted);
    if (b && b.exhausted) {
      const at = new Date(b.resets_at * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      qs("#budget-text").textContent = ` Daily download budget of ${b.limit_gb} GB reached — downloads resume at ${at}.`;
    }
  }
}

async function togglePause() {
  const s = DATA.status;
  const r = await api(s && s.paused ? "/api/queue/resume" : "/api/queue/pause", { method: "POST" });
  if (r) { await fetchForView(); updateShell(); render(); }
}

// ── data + render ──
async function fetchForView() {
  const [status] = await Promise.all([api("/api/status")]);
  if (status) DATA.status = status;
  if (active === "dashboard" || active === "downloads") {
    const dl = await api("/api/downloads?limit=1000"); if (dl) { DATA.downloads = dl; const ids = new Set(dl.map((d) => d.id)); [...ui.sel].forEach((i) => { if (!ids.has(i)) ui.sel.delete(i); }); }
  }
  if (active === "channels") { const ch = await api("/api/channels"); if (ch) DATA.channels = ch; }
  updateShell();
}

function render() {
  const root = qs("#view-root"); if (!root) return;
  const a = document.activeElement; const keepId = a && a.id; const pos = a && a.selectionStart;
  mount(root, NAV.find((n) => n.id === active).view(ctx));
  if (keepId) { const n = root.querySelector("#" + (window.CSS && CSS.escape ? CSS.escape(keepId) : keepId)); if (n) { n.focus(); try { n.selectionStart = n.selectionEnd = pos; } catch {} } }
  syncNav(); syncThemeBtn();
}

async function go(name) {
  active = TITLE[name] ? name : "dashboard";
  location.hash = "#/" + active;
  ui.sel.clear();
  syncNav();
  await fetchForView();
  render();
}
window.addEventListener("hashchange", () => { const n = location.hash.replace("#/", ""); if (TITLE[n] && n !== active) go(n); });

// ── live updates via Server-Sent Events ──
let _es = null, _prevCompleted = -1, _lastSSE = 0;
function connectSSE() {
  if (typeof EventSource === "undefined") return;
  try { _es = new EventSource("/api/events"); } catch { return; }
  _es.onmessage = (e) => {
    let d; try { d = JSON.parse(e.data); } catch { return; }
    _lastSSE = Date.now();
    DATA.status = { ...(DATA.status || {}), stats: d.stats, paused: d.paused, disk: d.disk, speed: d.speed, budget: d.budget };
    const others = DATA.downloads.filter((x) => !["downloading", "queued"].includes(x.status));
    DATA.downloads = [...d.active, ...others];
    updateShell();
    if (active === "dashboard") liveDashboard(ctx);
    else if (active === "downloads") { const el = qs("#dl-active"); if (el) mount(el, ...liveActive(ctx)); }
    if (d.stats.completed !== _prevCompleted) { _prevCompleted = d.stats.completed; fetchForView(); }
  };
  _es.onerror = () => {};   // EventSource auto-reconnects on drop
}

function getCommands() {
  const cmds = NAV.map((n) => ({ label: "Go to " + n.label, icon: n.icon, hint: "view", run: () => go(n.id) }));
  const paused = DATA.status && DATA.status.paused;
  cmds.push({ label: "Add channel", icon: "plus", run: () => openChannelModal(ctx, null) });
  cmds.push({ label: paused ? "Resume downloads" : "Pause downloads", icon: paused ? "play" : "pause", run: togglePause });
  cmds.push({ label: "Scan all channels", icon: "scan", run: async () => { const ch = (await api("/api/channels")) || []; for (const c of ch) await api(`/api/channels/${c.id}/scan`, { method: "POST" }); } });
  cmds.push({ label: "Backfill all channels", icon: "refresh", run: async () => { const ch = (await api("/api/channels")) || []; for (const c of ch) await api(`/api/channels/${c.id}/backfill`, { method: "POST" }); } });
  cmds.push({ label: "Toggle theme", icon: "sun", run: cycleTheme });
  cmds.push({ label: "Sign out", icon: "logout", run: () => { location.href = "/logout"; } });
  return cmds;
}

// ── boot ──
buildShell();
initPalette(getCommands);
go(active);
connectSSE();
// PWA service worker — needs a secure context (https or localhost); silently
// no-ops over plain-HTTP LAN, where install/offline aren't available anyway.
if ("serviceWorker" in navigator && window.isSecureContext) {
  navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
}
// fallback poll. Live views (dashboard/downloads) are driven by SSE; only re-render them
// here if SSE has gone quiet. Static views (channels/activity/settings) are NEVER auto
// re-rendered — that was resetting scroll/inputs. We only keep the shell status fresh.
setInterval(async () => {
  const sseDown = Date.now() - _lastSSE > 4000;
  if (sseDown && (active === "dashboard" || active === "downloads")) {
    await fetchForView(); render();
  } else {
    const s = await api("/api/status");
    if (s) { DATA.status = { ...(DATA.status || {}), authorized: s.authorized, disk: s.disk, stats: s.stats, paused: s.paused, budget: s.budget }; updateShell(); }
  }
}, 6000);
