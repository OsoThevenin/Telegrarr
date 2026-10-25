// telegram-connect.js — the Telegram sign-in dialog: API id/hash, phone, code
// and (when the account has one) the 2FA password.
import { h, mount, api, jpost } from "./core.js";
import { icon } from "./icons.js";
import { t, msg } from "./i18n.js";

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
      const a = field("API ID", { placeholder: t("common.example", { value: "123456" }), inputmode: "numeric" });
      const b = field("API Hash", { placeholder: t("common.example", { value: "a1b2c3…" }) });
      mount(body,
        h("p", { class: "muted small" }, t("tgw.api_intro_before"), h("a", { href: "https://my.telegram.org", target: "_blank", rel: "noopener" }, "my.telegram.org"), t("tgw.api_intro_after")),
        a.el, b.el,
        h("button", { class: "btn primary block", onClick: async () => { say(t("common.saving")); const r = await jpost("/api/telegram/auth/api", { api_id: a.input.value, api_hash: b.input.value }); r && r.ok ? step("phone") : say(msg(r && r.error) || t("tgw.failed"), "err"); } }, t("tgw.continue")));
      a.input.focus();
    } else if (name === "phone") {
      const p = field(t("tgw.phone"), { placeholder: "+34600123456", inputmode: "tel" });
      mount(body,
        h("p", { class: "muted small" }, t("tgw.phone_intro")),
        p.el,
        h("button", { class: "btn primary block", onClick: async () => { say(t("tgw.sending_code")); const r = await jpost("/api/telegram/auth/send_code", { phone: p.input.value }); r && r.ok ? step("code") : say(msg(r && r.error) || t("tgw.send_failed"), "err"); } }, t("tgw.send_code")));
      p.input.focus();
    } else if (name === "code") {
      const c = field(t("tgw.code"), { placeholder: "12345", inputmode: "numeric", autocomplete: "one-time-code" });
      mount(body,
        h("p", { class: "muted small" }, t("tgw.code_intro")),
        c.el,
        h("button", { class: "btn primary block", onClick: async () => { say(t("tgw.verifying")); const r = await jpost("/api/telegram/auth/sign_in", { code: c.input.value }); r && r.ok ? step("done") : r && r.need_password ? step("password") : say(msg(r && r.error) || t("tgw.invalid_code"), "err"); } }, t("tgw.verify")),
        h("button", { class: "btn ghost sm block", onClick: () => step("phone") }, t("tgw.other_number")));
      c.input.focus();
    } else if (name === "password") {
      const w = field(t("tgw.password"), { type: "password", placeholder: t("tgw.password_placeholder") });
      mount(body,
        h("p", { class: "muted small" }, t("tgw.password_intro")),
        w.el,
        h("button", { class: "btn primary block", onClick: async () => { say(t("tgw.signing_in")); const r = await jpost("/api/telegram/auth/password", { password: w.input.value }); r && r.ok ? step("done") : say(msg(r && r.error) || t("tgw.wrong_password"), "err"); } }, t("login.submit")));
      w.input.focus();
    } else {
      mount(body, h("div", { class: "tg-done" },
        h("span", { class: "tg-check", html: icon("check") }),
        h("h3", {}, t("tgw.done_title")),
        h("p", { class: "muted small" }, t("tgw.done_body")),
        h("button", { class: "btn primary block", onClick: close }, t("tgw.done"))));
    }
  };

  const overlay = h("div", { class: "modal", onClick: (e) => { if (e.target === overlay) close(); } },
    h("div", { class: "modal-card" },
      h("div", { class: "modal-head" }, h("h3", {}, t("banner.connect_telegram")),
        h("button", { class: "btn ghost icon", "aria-label": t("common.close"), onClick: close }, h("span", { html: icon("x") }))),
      body, err));
  host.replaceChildren(overlay);
  api("/api/telegram/auth").then((a) => step(a && a.api_ready ? "phone" : "api"));
}
