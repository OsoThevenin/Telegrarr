const STORAGE_KEY = "theme";

function storedTheme(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    // Blocked storage: follow the system preference, as "auto" does.
    return null;
  }
}

/** Honours the choice made in the old UI, which shares this origin. */
export function applyStoredTheme(): void {
  const theme = storedTheme();
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
}
