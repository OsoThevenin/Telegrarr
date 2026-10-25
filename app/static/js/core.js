// core.js — framework-free foundation: DOM builder, store, API client, helpers.
import { t, msg } from "./i18n.js";

// ── hyperscript DOM builder (XSS-safe: text is auto-escaped via text nodes) ──
export function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "html") e.innerHTML = v;                 // trusted only (SVG icons)
    else if (k === "dataset") Object.assign(e.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) e.setAttribute(k, "");
    else e.setAttribute(k, v);
  }
  add(e, kids);
  return e;
}
function add(e, kids) {
  for (const kid of kids) {
    if (kid == null || kid === false) continue;
    if (Array.isArray(kid)) add(e, kid);
    else e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
}
export const clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); return node; };
export const mount = (node, ...kids) => { clear(node); add(node, kids); return node; };
export const qs = (s, r = document) => r.querySelector(s);

// ── tiny reactive store ──
export function createStore(initial) {
  let state = { ...initial };
  const subs = new Set();
  return {
    get: () => state,
    set: (patch) => { state = { ...state, ...patch }; subs.forEach((f) => f(state)); },
    subscribe: (f) => { subs.add(f); return () => subs.delete(f); },
  };
}

// ── toasts ──
export function toast(msg, kind = "") {
  let host = qs("#toasts");
  if (!host) { host = h("div", { id: "toasts", class: "toasts" }); document.body.append(host); }
  const t = h("div", { class: `toast ${kind}` }, msg);
  host.append(t);
  setTimeout(() => t.remove(), 3200);
}

// ── API client ──
export async function api(url, opts = {}) {
  let r;
  try { r = await fetch(url, opts); }
  catch { toast(t("common.network_error"), "err"); return null; }
  if (r.status === 401) { location.href = "/login"; return null; }
  const ct = r.headers.get("content-type") || "";
  const body = ct.includes("json") ? await r.json().catch(() => null) : await r.text();
  if (!r.ok) { toast(body && body.detail ? msg(body.detail) : t("common.http_error", { status: r.status }), "err"); return null; }
  return body;
}
export const jpost = (url, obj) => api(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) });
export const jpatch = (url, obj) => api(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) });
export const jput = (url, obj) => api(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) });

export async function copy(text) {
  // navigator.clipboard needs a secure context (https or localhost). Over a
  // plain-HTTP LAN address it's undefined, so fall back to a hidden textarea +
  // execCommand, which still works there.
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      toast(t("common.copied"), "ok");
      return;
    }
  } catch { /* fall through to legacy path */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:-1000px;opacity:0";
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    try { ta.setSelectionRange(0, text.length); } catch { /* not a text field */ }
    const ok = document.execCommand("copy");
    ta.remove();
    toast(ok ? t("common.copied") : t("common.copy_failed"), ok ? "ok" : "err");
  } catch {
    toast(t("common.copy_failed"), "err");
  }
}

// ── formatters ──
export const gb = (b) => (b / 1e9).toFixed(2) + " GB";
export function fmtBytes(b) {
  if (!b) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
  return (b / Math.pow(1024, i)).toFixed(i ? 1 : 0) + " " + u[i];
}
export function fmtETA(d) {
  if (d.status !== "downloading" || !d.speed_mbs || !d.file_size) return "";
  const left = d.file_size - (d.progress || 0) * d.file_size;
  const secs = left / (d.speed_mbs * 1024 * 1024);
  if (!isFinite(secs) || secs <= 0) return "";
  const m = Math.floor(secs / 60), s = Math.floor(secs % 60);
  return m ? t("common.eta_min", { m, s }) : t("common.eta_sec", { s });
}
export const base = (p) => (p || "").split("/").pop();
