const STORAGE_KEY = "theme";

export const THEMES = ["auto", "light", "dark"] as const;

export type Theme = (typeof THEMES)[number];

let listeners: readonly (() => void)[] = [];

function storedTheme(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    // Blocked storage: the system preference decides.
    return null;
  }
}

function applyTheme(theme: string | null): void {
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

/** Honours the choice made in the old UI, which shares this origin. */
export function applyStoredTheme(): void {
  applyTheme(storedTheme());
}

export function currentTheme(): Theme {
  const theme = document.documentElement.dataset.theme;
  return theme === "light" || theme === "dark" ? theme : "auto";
}

export function subscribeToTheme(listener: () => void): () => void {
  listeners = [...listeners, listener];
  return () => {
    listeners = listeners.filter((other) => other !== listener);
  };
}

export function chooseTheme(theme: Theme): void {
  applyTheme(theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Blocked storage: the choice lasts until the page reloads.
  }
  for (const listener of listeners) listener();
}

/** Moves on to the next theme, in the old UI's order. */
export function cycleTheme(): void {
  chooseTheme(THEMES[(THEMES.indexOf(currentTheme()) + 1) % THEMES.length]);
}
