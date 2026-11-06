import { useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, type ServerMessage } from "@/lib/api";

export const ARR_APPS = ["prowlarr", "sonarr", "radarr"] as const;

export type ArrApp = (typeof ARR_APPS)[number];

type ArrSettings = Record<`${ArrApp}_url`, string> & Record<`${ArrApp}_key_set`, boolean>;

/** What `GET /api/settings` exposes: a secret is only ever a `_set` boolean. */
export type Settings = ArrSettings & {
  dl_workers: number;
  max_concurrent: number;
  min_free_gb: number;
  default_poll_minutes: number;
  poll_floor_minutes: number;
  daily_budget_gb: number;
  history_limit_per_show: number;
  plex_url: string;
  plex_token_set: boolean;
  tmdb_key_set: boolean;
  notify_webhook: string;
  notify_telegram: boolean;
  proxy_set: boolean;
  operating_mode: "arr" | "standalone";
  downloads_dir: string;
  telegrarr_url: string;
};

export type LibraryPaths = {
  tv_dir: string;
  tv_dir_4k: string;
  movies_dir: string;
  other_dir: string;
};

export type SettingsResponse = {
  settings: Settings;
  paths: LibraryPaths;
  user: string;
  arr: { apikey: string };
};

/** A keyed or plain outcome, as the integration test endpoints report it inside a 200. */
export type TestResult = { ok: boolean; detail?: ServerMessage };

type Patch = Record<string, unknown>;

export const SETTINGS_KEY = ["settings"] as const;

export function useSettings() {
  return useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: () => api.get<SettingsResponse>("/api/settings"),
  });
}

/** Writes through `PATCH /api/settings`; the response is what the server really kept. */
export function useSaveSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (patch: Patch) => {
      const { settings } = await api.patch<{ settings: Settings }>("/api/settings", patch);
      return settings;
    },
    onSuccess: (settings) => {
      queryClient.setQueryData<SettingsResponse>(SETTINGS_KEY, (current) => current && { ...current, settings });
    },
  });
}

function formValues<K extends keyof Settings>(settings: Settings, keys: readonly K[]): Record<K, string> {
  return Object.fromEntries(keys.map((key) => [key, String(settings[key])])) as Record<K, string>;
}

function isSameValue(a: string, b: string): boolean {
  if (a === b) return true;
  return a.trim() !== "" && b.trim() !== "" && Number(a) === Number(b);
}

/** The fields that differ from what is saved, so an unchanged env-locked key cannot abort a patch. */
function changedValues<K extends string>(saved: Record<K, string>, form: Record<K, string>): Partial<Record<K, string>> {
  const keys = Object.keys(form) as K[];
  return Object.fromEntries(keys.filter((key) => !isSameValue(saved[key], form[key])).map((key) => [key, form[key]])) as Partial<
    Record<K, string>
  >;
}

export type SaveOutcome =
  | { kind: "idle" }
  | { kind: "saved" }
  /** Saved, but the server clamped or skipped something: the form now shows what it kept. */
  | { kind: "adjusted" }
  | { kind: "failed"; error: unknown };

const IDLE: SaveOutcome = { kind: "idle" };

/** The drafts of one card's fields, re-rendered from the response after every save. */
export function useSettingsForm<K extends keyof Settings>(settings: Settings, keys: readonly K[]) {
  const save = useSaveSettings();
  const [form, setForm] = useState(() => formValues(settings, keys));
  const [outcome, setOutcome] = useState<SaveOutcome>(IDLE);

  const changed = changedValues(formValues(settings, keys), form);
  const isDirty = Object.keys(changed).length > 0;

  function setField(key: K, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
    setOutcome(IDLE);
  }

  /** Saves the changed fields plus any secrets; says whether the card may go on. */
  async function submit(secrets: Patch = {}): Promise<boolean> {
    const patch = { ...changed, ...secrets };
    if (Object.keys(patch).length === 0) return true;
    try {
      const kept = formValues(await save.mutateAsync(patch), keys);
      const wasAdjusted = Object.keys(changedValues(kept, form)).length > 0;
      setForm(kept);
      setOutcome({ kind: wasAdjusted ? "adjusted" : "saved" });
      return true;
    } catch (error) {
      setOutcome({ kind: "failed", error });
      return false;
    }
  }

  return { form, setField, isDirty, isSaving: save.isPending, outcome, submit };
}
