// connect.js — Connect page: Prowlarr / Sonarr / Radarr credentials, connection
// tests and one-click registration of Telegrarr. API keys are write-only: the
// server only reports whether one is saved.
import { h, api, jpost, jpatch, toast } from "./core.js";

const APPS = [
  { id: "prowlarr", label: "Prowlarr", port: 9696, role: "Telegrarr is added as a Generic Newznab indexer." },
  { id: "sonarr", label: "Sonarr", port: 8989, role: "Telegrarr is added as a SABnzbd download client (category tv)." },
  { id: "radarr", label: "Radarr", port: 7878, role: "Telegrarr is added as a SABnzbd download client (category movies)." },
];
const STATUS_TEXT = { created: "created", exists: "already registered", skipped: "skipped", error: "failed" };
const STATUS_TONE = { created: "ok", exists: "ok", skipped: "muted", error: "err" };

const card = (title, ...body) => h("section", { class: "card" }, h("div", { class: "card-h" }, title), ...body);
const row = (label, input, hint) => h("div", { class: "set-row" },
  h("label", {}, label, hint && h("div", { class: "hint" }, hint)), input);
const say = (out, text, tone) => { out.textContent = text; out.style.color = `var(--${tone})`; };

function appCard(app, s) {
  const urlInp = h("input", { type: "url", value: s[`${app.id}_url`] || "", placeholder: `http://${app.id}:${app.port}` });
  const keyInp = h("input", { type: "password", autocomplete: "off",
    placeholder: s[`${app.id}_key_set`] ? "•••• saved — type to replace" : "Settings → General → API Key" });
  const out = h("span", { class: "test-out" });
  const saveAndTest = async () => {
    const patch = { [`${app.id}_url`]: urlInp.value };
    if (keyInp.value) patch[`${app.id}_key`] = keyInp.value;
    if (!(await jpatch("/api/settings", patch))) return;
    keyInp.value = "";
    say(out, "Testing…", "muted");
    const r = await jpost("/api/connect/test", { app: app.id });
    if (r) say(out, r.ok ? `Connected · v${r.version}` : r.error, r.ok ? "ok" : "err");
  };
  return card(app.label,
    h("div", { class: "muted small", style: "margin-bottom:10px" }, app.role),
    row("URL", urlInp, "as reachable from Telegrarr"),
    row("API key" + (s[`${app.id}_key_set`] ? " (saved)" : ""), keyInp),
    h("div", { class: "set-actions" }, h("button", { class: "btn primary sm", onClick: saveAndTest }, "Save & test"), out));
}

function resultLine(res) {
  const label = APPS.find((a) => a.id === res.app)?.label || res.app;
  const text = `${label} ${res.kind}: ${STATUS_TEXT[res.status] || res.status}${res.error ? ` — ${res.error}` : ""}`;
  return h("div", { style: `color:var(--${STATUS_TONE[res.status] || "muted"})` }, text);
}

function registerCard(s) {
  const meInp = h("input", { type: "url", value: s.telegrarr_url || location.origin });
  const results = h("div", { class: "small stack", style: "margin-top:12px;gap:4px" });
  const register = async () => {
    if (!(await jpatch("/api/settings", { telegrarr_url: meInp.value }))) return;
    const r = await jpost("/api/connect/register", {});
    if (!r) return;
    results.replaceChildren(...r.results.map(resultLine));
    const created = r.results.filter((x) => x.status === "created").length;
    toast(created ? `Registered in ${created} app${created > 1 ? "s" : ""}` : "Nothing new to register", "ok");
  };
  return card("Register Telegrarr",
    h("div", { class: "muted small", style: "margin-bottom:10px" },
      "One click adds Telegrarr to every app saved above. Safe to repeat: anything already named “Telegrarr” is left as is. "
      + "Prefer doing it by hand? See docs/CONNECT.md."),
    row("Telegrarr URL", meInp, "how Prowlarr, Sonarr and Radarr reach Telegrarr, e.g. http://telegrarr:8790"),
    h("div", { class: "set-actions" }, h("button", { class: "btn primary sm", onClick: register }, "Register Telegrarr")),
    results);
}

export function viewConnect() {
  const root = h("div", { class: "stack settings-wrap" }, h("div", { class: "empty" }, "Loading…"));
  (async () => {
    const data = await api("/api/settings"); if (!data) return;
    const s = data.settings;
    root.replaceChildren(h("div", { class: "settings-cols" }, ...APPS.map((a) => appCard(a, s)), registerCard(s)));
  })();
  return root;
}
