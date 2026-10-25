// system.js — System page: health and version, scheduled scans, backups and updates.
import { h, mount, api, jpost, toast, fmtBytes } from "./core.js";
import { icon } from "./icons.js";
import { t, tOr, msg } from "./i18n.js";
import { ui, card, fmtWhen, fmtWeekdays } from "./views.js";

function fmtDur(sec) {
  sec = Math.max(0, sec | 0);
  const d = Math.floor(sec / 86400), hh = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  if (d) return t("dur.dh", { d, h: hh });
  if (hh) return t("dur.hm", { h: hh, m });
  if (m) return t("dur.m", { m });
  return t("dur.s", { s: sec });
}
const infoGrid = (pairs) => h("div", { class: "info-grid" },
  ...pairs.flatMap(([k, v]) => [h("div", { class: "info-k" }, k), h("div", { class: "info-v mono" }, String(v))]));

const SYS_TABS = [["status", t("sys.tab.status")], ["tasks", t("sys.tab.tasks")], ["backup", t("sys.tab.backup")], ["updates", t("sys.tab.updates")]];

export function viewSystem(ctx) {
  const sub = ui.sysTab || "status";
  const body = h("div", { class: "stack" }, h("div", { class: "empty" }, t("common.loading")));
  const tabs = h("div", { class: "tabs" }, ...SYS_TABS.map(([id, label]) =>
    h("button", { class: "tab " + (sub === id ? "on" : ""), onClick: () => { ui.sysTab = id; ctx.rerender(); } }, label)));
  ({ status: sysStatus, tasks: sysTasks, backup: sysBackup, updates: sysUpdates }[sub])(body);
  return h("div", { class: "stack" }, tabs, body);
}

async function sysStatus(root) {
  const s = await api("/api/system/status"); if (!s) return;
  const badge = (ok, level) => h("span", { class: "pill " + (ok ? "s-completed" : (level === "warn" ? "s-queued" : "s-failed")) },
    ok ? t("sys.ok") : (level === "warn" ? t("sys.warning") : t("sys.error")));
  const health = card(t("sys.health"),
    h("div", { class: "sys-health" }, ...s.health.map((x) =>
      h("div", { class: "sys-hrow" },
        h("span", { class: "dot " + (x.ok ? "ok" : (x.level === "warn" ? "" : "bad")) }),
        h("span", { class: "sys-hname" }, tOr(`health.${x.id}.name`, x.id)),
        h("span", { class: "sys-hmsg muted" }, msg(x.message)),
        badge(x.ok, x.level)))));
  const about = card(t("sys.about"), infoGrid([
    [t("sys.version"), "v" + s.version],
    ["Python", s.python],
    [t("sys.platform"), s.platform],
    [t("sys.uptime"), fmtDur(s.uptime_seconds)],
    [t("nav.channels"), t("sys.channels_value", { enabled: s.channels_enabled, total: s.channels })],
    [t("sys.workers"), t("sys.workers_value", { workers: s.workers, concurrent: s.max_concurrent })],
    [t("health.database.name"), fmtBytes(s.db_size)],
    [t("sys.disk"), t("sys.disk_value", { free: fmtBytes(s.disk.free), total: fmtBytes(s.disk.total) })],
    [t("sys.data_dir"), s.data_dir],
  ]));
  mount(root, health, about);
}

async function sysTasks(root) {
  const rows = await api("/api/system/tasks"); if (!rows) return;
  const head = h("div", { class: "dl-controls" },
    h("button", { class: "btn primary sm", onClick: async () => { const r = await jpost("/api/system/tasks/scan_all", {}); if (r) toast(msg(r.message) || t("sys.scanning"), "ok"); } },
      h("span", { html: icon("scan") }), t("sys.scan_all_now")),
    h("span", { class: "muted small" }, t("sys.tasks_hint")));
  const table = h("div", { class: "data-card" }, h("table", {},
    h("thead", {}, h("tr", {}, h("th", {}, t("sys.task")), h("th", {}, t("sys.interval")), h("th", {}, t("sys.days")), h("th", {}, t("sys.last_run")), h("th", {}, t("sys.next_run")), h("th", {}, ""))),
    h("tbody", {}, ...(rows.length ? rows.map((task) => h("tr", {},
      h("td", {}, t("sys.task_scan", { title: task.title })),
      h("td", { class: "num" }, t("sys.every_minutes", { n: task.poll_minutes })),
      h("td", { class: "muted" }, fmtWeekdays(task.weekdays)),
      h("td", { class: "num muted" }, fmtWhen(task.last_run)),
      h("td", { class: "num" }, task.enabled ? fmtWhen(task.next_run) : h("span", { class: "muted" }, t("sys.disabled"))),
      h("td", { class: "actions" }, h("button", { class: "btn ghost sm", onClick: async () => { await api(`/api/channels/${task.channel_id}/scan`, { method: "POST" }); toast(t("scan.started"), "ok"); } }, t("sys.run")))))
      : [h("tr", {}, h("td", { colspan: 6 }, h("div", { class: "empty" }, t("sys.no_tasks"))))]))));
  mount(root, head, table);
}

async function sysBackup(root) {
  const list = (await api("/api/system/backups")) || [];
  const head = h("div", { class: "dl-controls" },
    h("button", { class: "btn primary sm", onClick: async () => { const r = await jpost("/api/system/backups", {}); if (r && r.name) { toast(t("backup.created"), "ok"); sysBackup(root); } } },
      h("span", { html: icon("disk") }), t("backup.now")),
    h("span", { class: "muted small" }, t("backup.hint")));
  const table = h("div", { class: "data-card" }, h("table", {},
    h("thead", {}, h("tr", {}, h("th", {}, t("backup.col.name")), h("th", {}, t("dl.col.size")), h("th", {}, t("backup.col.created")), h("th", {}, ""))),
    h("tbody", {}, ...(list.length ? list.map((b) => h("tr", {},
      h("td", {}, b.name),
      h("td", { class: "num" }, fmtBytes(b.size)),
      h("td", { class: "num muted" }, fmtWhen(b.created)),
      h("td", { class: "actions" },
        h("a", { class: "btn ghost sm", href: `/api/system/backups/${encodeURIComponent(b.name)}/download` }, h("span", { html: icon("external") }), t("backup.download")),
        h("button", { class: "btn ghost sm icon", title: t("backup.delete"), "aria-label": t("backup.delete"), onClick: async () => { if (confirm(t("backup.delete_confirm"))) { await api(`/api/system/backups/${encodeURIComponent(b.name)}`, { method: "DELETE" }); toast(t("backup.deleted"), "ok"); sysBackup(root); } } }, h("span", { html: icon("trash") })))))
      : [h("tr", {}, h("td", { colspan: 4 }, h("div", { class: "empty" }, t("backup.none"))))]))));
  const note = card(t("backup.restore"),
    h("p", { class: "muted small", style: "margin:0;line-height:1.6" }, t("backup.restore_body")));
  mount(root, head, table, note);
}

async function sysUpdates(root) {
  const u = await api("/api/system/updates"); if (!u) return;
  const status = u.up_to_date
    ? h("div", { class: "chip" }, h("span", { html: icon("check") }), u.latest ? t("updates.latest") : t("updates.none_newer"))
    : h("div", { class: "chip", style: "background:color-mix(in srgb,var(--accent) 14%,transparent);color:var(--accent)" }, h("span", { html: icon("upload") }), t("updates.available", { version: u.latest }));
  mount(root, card(t("sys.tab.updates"),
    infoGrid([
      [t("updates.installed"), "v" + u.current],
      [t("updates.latest_label"), u.latest ? "v" + u.latest : (msg(u.error) || t("common.unknown"))],
    ]),
    h("div", { style: "margin-top:16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap" },
      status,
      h("a", { class: "btn ghost sm", href: u.url, target: "_blank", rel: "noopener" }, h("span", { html: icon("external") }), t("updates.release_notes")))));
}
