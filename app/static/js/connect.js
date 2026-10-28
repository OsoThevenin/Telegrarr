// connect.js — Connect page: Prowlarr / Sonarr / Radarr credentials, connection
// tests and one-click registration of Telegrarr. API keys are write-only: the
// server only reports whether one is saved.
import { h, api, jpost, jpatch, jput, toast } from "./core.js";
import { t, tn, msg } from "./i18n.js";

const APPS = [
  { id: "prowlarr", label: "Prowlarr", port: 9696, role: t("connect.role.prowlarr") },
  { id: "sonarr", label: "Sonarr", port: 8989, role: t("connect.role.sonarr") },
  { id: "radarr", label: "Radarr", port: 7878, role: t("connect.role.radarr") },
];
const STATUS_TONE = { created: "ok", exists: "ok", skipped: "muted", error: "err" };

const card = (title, ...body) => h("section", { class: "card" }, h("div", { class: "card-h" }, title), ...body);
const row = (label, input, hint) => h("div", { class: "set-row" },
  h("label", {}, label, hint && h("div", { class: "hint" }, hint)), input);
const say = (out, text, tone) => { out.textContent = text; out.style.color = `var(--${tone})`; };

function appCard(app, s) {
  const urlInp = h("input", { type: "url", value: s[`${app.id}_url`] || "", placeholder: `http://${app.id}:${app.port}` });
  const keyInp = h("input", { type: "password", autocomplete: "off",
    placeholder: s[`${app.id}_key_set`] ? t("common.key_saved_placeholder") : t("connect.key_placeholder") });
  const out = h("span", { class: "test-out" });
  const saveAndTest = async () => {
    const patch = { [`${app.id}_url`]: urlInp.value };
    if (keyInp.value) patch[`${app.id}_key`] = keyInp.value;
    if (!(await jpatch("/api/settings", patch))) return;
    keyInp.value = "";
    say(out, t("common.testing"), "muted");
    const r = await jpost("/api/connect/test", { app: app.id });
    if (r) say(out, r.ok ? t("connect.connected_version", { version: r.version }) : msg(r.error), r.ok ? "ok" : "err");
    if (r && extra) extra.reload();
  };
  const extra = app.id === "radarr" ? radarrDefaults() : null;
  return card(app.label,
    h("div", { class: "muted small", style: "margin-bottom:10px" }, app.role),
    row(t("common.url"), urlInp, t("connect.url_hint")),
    row(t("common.api_key") + (s[`${app.id}_key_set`] ? ` ${t("common.saved_suffix")}` : ""), keyInp),
    h("div", { class: "set-actions" }, h("button", { class: "btn primary sm", onClick: saveAndTest }, t("common.save_test")), out),
    extra && extra.node);
}

// ── default quality profile + root folder for films Telegrarr adds to Radarr ──
const RADARR_DEFAULTS = "/api/connect/radarr/defaults";

async function loadRadarrDefaults() {
  // fetch directly (not api()): an unreachable Radarr is shown inline, not toasted.
  try {
    const r = await fetch(RADARR_DEFAULTS);
    const body = await r.json().catch(() => null);
    if (r.ok) return { choices: body };
    return { error: body && body.detail ? msg(body.detail) : t("common.http_error", { status: r.status }) };
  } catch {
    return { error: t("common.network_error") };
  }
}

function radarrDefaults() {
  const profileSel = h("select", { id: "radarr-profile" });
  const folderSel = h("select", { id: "radarr-root-folder" });
  const out = h("span", { class: "test-out" });
  const saveBtn = h("button", { class: "btn sm", disabled: true, onClick: async () => {
    const saved = await jput(RADARR_DEFAULTS, { quality_profile_id: Number(profileSel.value), root_folder: folderSel.value });
    if (saved) say(out, t("connect.radarr_defaults.saved"), "ok");
  } }, t("common.save"));
  const fill = (sel, items, value, label) => sel.replaceChildren(...items.map((it) =>
    h("option", { value: String(value(it)) }, label(it))));
  const reload = async () => {
    say(out, t("common.loading"), "muted");
    const { choices, error } = await loadRadarrDefaults();
    saveBtn.disabled = !choices;
    if (!choices) { profileSel.replaceChildren(); folderSel.replaceChildren(); say(out, t("connect.radarr_defaults.unavailable", { error }), "err"); return; }
    fill(profileSel, choices.quality_profiles, (p) => p.id, (p) => p.name);
    fill(folderSel, choices.root_folders, (f) => f.path, (f) => f.path);
    profileSel.value = String(choices.selected.quality_profile_id ?? "");
    folderSel.value = choices.selected.root_folder ?? "";
    say(out, "", "muted");
  };
  const node = h("div", { style: "margin-top:14px" },
    h("div", { class: "muted small", style: "margin-bottom:10px" }, t("connect.radarr_defaults.intro")),
    row(t("connect.radarr_defaults.profile"), profileSel),
    row(t("connect.radarr_defaults.root_folder"), folderSel),
    h("div", { class: "set-actions" }, saveBtn, out));
  reload();
  return { node, reload };
}

function resultLine(res) {
  const label = APPS.find((a) => a.id === res.app)?.label || res.app;
  const status = t(`connect.status.${res.status}`);
  const text = `${label} · ${t(`connect.kind.${res.kind}`)}: ${status}${res.error ? ` — ${msg(res.error)}` : ""}`;
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
    toast(created ? tn("connect.registered", created) : t("connect.nothing_new"), "ok");
  };
  return card(t("connect.register_title"),
    h("div", { class: "muted small", style: "margin-bottom:10px" },
      t("connect.register_intro")),
    row(t("connect.own_url"), meInp, t("connect.own_url_hint")),
    h("div", { class: "set-actions" }, h("button", { class: "btn primary sm", onClick: register }, t("connect.register_title"))),
    results);
}

export function viewConnect() {
  const root = h("div", { class: "stack settings-wrap" }, h("div", { class: "empty" }, t("common.loading")));
  (async () => {
    const data = await api("/api/settings"); if (!data) return;
    const s = data.settings;
    root.replaceChildren(h("div", { class: "settings-cols" }, ...APPS.map((a) => appCard(a, s)), registerCard(s)));
  })();
  return root;
}
