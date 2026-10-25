// i18n.js — UI translations. The server renders <html lang> from the persisted
// ui_lang setting; this module loads the matching dictionary before any view
// module runs (top-level await), so every t() call below is synchronous.
//
// Dictionaries: /static/i18n/{ca,en}.json, flat "area.thing" keys.
// Placeholders are {name}; plurals use "key.one" / "key.other" with {n}.
// Server messages arrive as {key, params} and go through msg().

const LANGS = ["ca", "en"];
export const lang = LANGS.includes(document.documentElement.lang) ? document.documentElement.lang : "ca";
export const locale = lang === "ca" ? "ca-ES" : "en-US";

async function load(code) {
  try {
    const r = await fetch(`/static/i18n/${code}.json`);
    return r.ok ? await r.json() : {};
  } catch {
    return {};
  }
}
const DICT = await load(lang);
const plural = new Intl.PluralRules(locale);

const fill = (text, params) =>
  text.replace(/\{(\w+)\}/g, (m, name) => (params && params[name] != null ? String(params[name]) : m));

// Unknown keys render as the key itself so a missing entry is visible, not blank.
export function t(key, params) {
  const text = DICT[key];
  return fill(text == null ? key : text, params);
}

// For open-ended server values (e.g. a channel kind): translate if known, else show as is.
export const tOr = (key, fallback, params) => (key in DICT ? t(key, params) : fallback);

export function tn(key, n, params) {
  const form = plural.select(n) === "one" ? "one" : "other";
  return t(`${key}.${form}`, { ...params, n: n.toLocaleString(locale) });
}

// A server message: {key, params} → translated text. Plain strings (third-party
// text, legacy) pass through unchanged.
export function msg(m) {
  if (m == null) return "";
  if (typeof m === "string") return m;
  if (typeof m === "object" && m.key) return t(m.key, m.params);
  return String(m);
}

export const fmtDateTime = (d) => d.toLocaleString(locale);
export const fmtTime = (d) => d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
