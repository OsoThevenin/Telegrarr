import { useTranslation } from "react-i18next";

import { LANGUAGES, type Language } from "@/i18n";
import { ApiError, type ServerMessage } from "@/lib/api";

type Params = Record<string, unknown>;

type I18n = {
  language: Language;
  /** Looks up a key; an unknown key renders as itself. */
  t: (key: string, params?: Params) => string;
  /** Picks `key.one` or `key.other` for a count and fills `{n}` with it, localized. */
  tn: (key: string, n: number, params?: Params) => string;
  /** Translates a message from the server; plain text passes through. */
  msg: (message: ServerMessage | null | undefined) => string;
  /** What to tell the user about a failed API call. */
  errorText: (error: unknown) => string;
};

function isTranslatable(value: unknown): value is { key: string; params?: Params } {
  return typeof value === "object" && value !== null && "key" in value;
}

export function useI18n(): I18n {
  const { t: translate, i18n } = useTranslation();
  const language = LANGUAGES.find(({ code }) => code === i18n.language) ?? LANGUAGES[0];

  const t: I18n["t"] = (key, params = {}) => {
    // A param may itself be a server message: it is translated too.
    const replace = Object.fromEntries(
      Object.entries(params).map(([name, value]) => [
        name,
        isTranslatable(value) ? t(value.key, value.params) : value,
      ]),
    );
    return translate(key, { replace });
  };

  const tn: I18n["tn"] = (key, n, params) => {
    const form = new Intl.PluralRules(language.locale).select(n) === "one" ? "one" : "other";
    return t(`${key}.${form}`, { ...params, n: n.toLocaleString(language.locale) });
  };

  const msg: I18n["msg"] = (message) => {
    if (message == null) return "";
    return typeof message === "string" ? message : t(message.key, message.params);
  };

  const errorText: I18n["errorText"] = (error) => {
    if (!(error instanceof ApiError)) return t("common.network_error");
    return error.detail ? msg(error.detail) : t("common.http_error", { status: error.status });
  };

  return { language: language.code, t, tn, msg, errorText };
}
