// palette.js — ⌘K / Ctrl-K command palette (fuzzy nav + actions).
import { h, mount } from "./core.js";
import { icon } from "./icons.js";
import { t } from "./i18n.js";

let getCommands = null, overlay = null;

export function initPalette(provider) {
  getCommands = provider;
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openCommandPalette(); }
    else if (e.key === "Escape" && overlay) close();
  });
}

export function openCommandPalette() {
  if (!getCommands) return;
  if (overlay) return close();
  const all = getCommands();
  let items = all, sel = 0;
  const input = h("input", { class: "cmdk-input", placeholder: t("palette.placeholder"), autocomplete: "off", spellcheck: "false" });
  const list = h("div", { class: "cmdk-list" });

  const draw = () => {
    const q = input.value.trim().toLowerCase();
    items = q ? all.filter((c) => (c.label + " " + (c.hint || "")).toLowerCase().includes(q)) : all;
    if (sel >= items.length) sel = Math.max(0, items.length - 1);
    mount(list, ...(items.length ? items.map((c, i) =>
      h("button", { class: "cmdk-item" + (i === sel ? " on" : ""), onmousedown: (ev) => { ev.preventDefault(); run(c); } },
        h("span", { class: "cmdk-ico", html: icon(c.icon || "chevron-right") }),
        h("span", { class: "cmdk-label" }, c.label),
        c.hint ? h("span", { class: "cmdk-hint" }, c.hint) : null,
        c.kbd ? h("kbd", {}, c.kbd) : null))
      : [h("div", { class: "cmdk-empty" }, t("palette.empty"))]));
  };
  const run = (c) => { close(); try { c.run(); } catch {} };

  input.addEventListener("input", () => { sel = 0; draw(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); draw(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(0, sel - 1); draw(); }
    else if (e.key === "Enter") { e.preventDefault(); if (items[sel]) run(items[sel]); }
  });

  overlay = h("div", { class: "cmdk", onclick: (e) => { if (e.target === overlay) close(); } },
    h("div", { class: "cmdk-box" },
      h("div", { class: "cmdk-head" }, h("span", { class: "cmdk-k", html: icon("search") }), input),
      list,
      h("div", { class: "cmdk-foot" }, h("kbd", {}, "↑↓"), ` ${t("palette.navigate")} `, h("kbd", {}, "↵"), ` ${t("palette.run")} `, h("kbd", {}, "esc"), ` ${t("palette.close")}`)));
  document.body.append(overlay);
  draw();
  input.focus();
}

function close() { if (overlay) { overlay.remove(); overlay = null; } }
