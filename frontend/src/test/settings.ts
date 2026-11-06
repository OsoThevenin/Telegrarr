import { http, HttpResponse } from "msw";

import type { Settings, SettingsResponse } from "@/lib/settings";

/** A fresh install as the backend reports it: nothing connected, nothing saved. */
export const FRESH_SETTINGS: Settings = {
  dl_workers: 4,
  max_concurrent: 2,
  min_free_gb: 5,
  default_poll_minutes: 60,
  poll_floor_minutes: 15,
  daily_budget_gb: 0,
  history_limit_per_show: 0,
  plex_url: "",
  plex_token_set: false,
  tmdb_key_set: false,
  notify_webhook: "",
  notify_telegram: false,
  proxy_set: false,
  operating_mode: "arr",
  downloads_dir: "/downloads",
  telegrarr_url: "",
  prowlarr_url: "",
  prowlarr_key_set: false,
  sonarr_url: "",
  sonarr_key_set: false,
  radarr_url: "",
  radarr_key_set: false,
};

export function settingsResponse(overrides: Partial<Settings> = {}): SettingsResponse {
  return {
    settings: { ...FRESH_SETTINGS, ...overrides },
    paths: { tv_dir: "/tv", tv_dir_4k: "/tv4k", movies_dir: "/movies", other_dir: "/other" },
    user: "admin",
    arr: { apikey: "abcdef123456wxyz" },
  };
}

/** The reads every Settings render makes. */
export function settingsHandlers(overrides: Partial<Settings> = {}) {
  return [
    http.get("/api/settings", () => HttpResponse.json(settingsResponse(overrides))),
    http.get("/api/telegram/auth", () => HttpResponse.json({ authorized: false, api_ready: false })),
    http.get("/api/telegram/proxy", () => HttpResponse.json({ proxy: "" })),
  ];
}
