const STORAGE_KEY = "theme";

export const THEMES = ["auto", "light", "dark"] as const;

export type Theme = (typeof THEMES)[number];

function storedTheme(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    // Blocked storage: follow the system preference, as "auto" does.
    return null;
  }
}

function applyTheme(theme: Theme): void {
  if (theme === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

export function currentTheme(): Theme {
  return THEMES.find((theme) => theme === storedTheme()) ?? "auto";
}

/** Honours the choice made in the old UI, which shares this origin. */
export function applyStoredTheme(): void {
  applyTheme(currentTheme());
}

export function chooseTheme(theme: Theme): void {
  applyTheme(theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Blocked storage: the choice lasts until the page is reloaded.
  }
}
