import { useQuery, useQueryClient } from "@tanstack/react-query";

import { api, ApiError, type ServerMessage } from "@/lib/api";
import { SETTINGS_KEY } from "@/lib/settings";
import { STATUS_KEY } from "@/lib/status";

const AUTH_KEY = ["telegram", "auth"] as const;
const PROXY_KEY = ["telegram", "proxy"] as const;

type TelegramAuth = { authorized: boolean; api_ready: boolean };

/** Telegram failures arrive inside a 200 as `{ error }`: this makes them failures. */
export async function telegramPost<T>(path: string, body?: unknown): Promise<T> {
  const result = await api.post<T & { error?: ServerMessage }>(path, body);
  if (result.error) throw new ApiError(200, result.error);
  return result;
}

export function useTelegramAuth() {
  return useQuery({
    queryKey: AUTH_KEY,
    queryFn: () => api.get<TelegramAuth>("/api/telegram/auth"),
  });
}

/** The saved proxy, already masked by the server. */
export function useTelegramProxy() {
  return useQuery({
    queryKey: PROXY_KEY,
    queryFn: () => api.get<{ proxy: string }>("/api/telegram/proxy"),
  });
}

export function useRefreshTelegram() {
  const queryClient = useQueryClient();

  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: AUTH_KEY }),
      queryClient.invalidateQueries({ queryKey: PROXY_KEY }),
      queryClient.invalidateQueries({ queryKey: SETTINGS_KEY }),
      queryClient.invalidateQueries({ queryKey: STATUS_KEY }),
    ]);
  };
}
