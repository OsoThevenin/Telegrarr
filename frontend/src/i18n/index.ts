import { createInstance } from "i18next";
import { initReactI18next } from "react-i18next";

// One dictionary for both UIs: the backend owns these files and tests/test_i18n.py
// checks every key the frontend uses.
import ca from "../../../app/static/i18n/ca.json";
import en from "../../../app/static/i18n/en.json";

export const LANGUAGES = [
  { code: "ca", label: "Català", locale: "ca-ES" },
  { code: "en", label: "English", locale: "en-US" },
] as const;

export type Language = (typeof LANGUAGES)[number]["code"];

export const DEFAULT_LANGUAGE: Language = "ca";

function pageLanguage(): Language {
  const lang = document.documentElement.lang;
  return LANGUAGES.find(({ code }) => code === lang)?.code ?? DEFAULT_LANGUAGE;
}

export const i18n = createInstance();

// The keys are flat ("nav.dashboard") and use single braces ("{n}"), as the old UI
// and the backend do. An unknown key renders as itself.
void i18n.use(initReactI18next).init({
  initAsync: false,
  lng: pageLanguage(),
  fallbackLng: false,
  resources: { ca: { translation: ca }, en: { translation: en } },
  keySeparator: false,
  nsSeparator: false,
  interpolation: { prefix: "{", suffix: "}", escapeValue: false },
  react: { useSuspense: false },
});

/** Switches the running UI to a language, with no reload. */
export async function applyLanguage(language: Language): Promise<void> {
  await i18n.changeLanguage(language);
  document.documentElement.lang = language;
}
