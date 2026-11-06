import { useQuery } from "@tanstack/react-query";

import { api, type ServerMessage } from "@/lib/api";
import type { ArrApp } from "@/lib/settings";

export const RADARR_DEFAULTS_PATH = "/api/connect/radarr/defaults";
export const RADARR_DEFAULTS_KEY = ["connect", "radarr-defaults"] as const;

/** The app's verdict arrives inside a 200 either way. */
type AppStatus = { ok: true; version: string } | { ok: false; error?: ServerMessage };

export type RadarrDefaultChoices = {
  quality_profiles: { id: number; name: string }[];
  root_folders: { path: string }[];
  selected: { quality_profile_id: number | null; root_folder: string | null };
};

/** Asks the app for its status, which only reads from it, so it is safe on load. */
export function useAppStatus(app: ArrApp, isSetUp: boolean) {
  return useQuery({
    queryKey: ["connect", "status", app],
    queryFn: () => api.post<AppStatus>("/api/connect/test", { app }),
    enabled: isSetUp,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useRadarrDefaults() {
  return useQuery({
    queryKey: RADARR_DEFAULTS_KEY,
    queryFn: () => api.get<RadarrDefaultChoices>(RADARR_DEFAULTS_PATH),
    retry: false,
    refetchOnWindowFocus: false,
  });
}
