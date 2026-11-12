/** The Settings tabs, in the order the tab bar shows them; the first is where Settings opens. */
export const SETTINGS_TABS = ["account", "downloads", "integrations"] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number];

export const DEFAULT_SETTINGS_TAB: SettingsTab = "account";

/** The tab a URL names, or none for a value that names no tab. */
export const settingsTabFromUrl = (id: unknown): SettingsTab | undefined =>
  SETTINGS_TABS.find((tab) => tab === id);
