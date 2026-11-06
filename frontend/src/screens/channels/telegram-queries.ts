import { useMutation, useQuery } from "@tanstack/react-query";

import { api, ApiError, type ServerMessage } from "@/lib/api";

const STATUS_OK = 200;

/** A chat the account is in, as GET /api/telegram/dialogs lists it. */
export type TelegramChat = {
  chat_id: number;
  title: string;
  username: string;
  kind: "channel" | "group";
};

/** The chat a channel is added from. */
export type PickedChat = Pick<TelegramChat, "chat_id" | "title" | "username">;

/**
 * Account safety: each of these is a read against Telegram, so they run once per opening of the
 * form, and never again because the window got focus or the call failed.
 */
const TELEGRAM_READ = { retry: false, refetchOnWindowFocus: false, staleTime: Infinity, gcTime: 0 } as const;

export const useDialogs = () =>
  useQuery({
    ...TELEGRAM_READ,
    queryKey: ["telegram-dialogs"],
    queryFn: () => api.get<TelegramChat[]>("/api/telegram/dialogs"),
  });

/** The endpoint answers 200 either way: a failure comes back as `{ error }`. */
type ResolveReply = PickedChat | { error?: ServerMessage };

async function resolveChat(query: string): Promise<PickedChat> {
  const reply = await api.post<ResolveReply>("/api/telegram/resolve", { query });
  if ("chat_id" in reply) return reply;

  throw new ApiError(STATUS_OK, reply.error ?? { key: "chm.resolve_failed" });
}

export const useResolveChat = () => useMutation({ mutationFn: resolveChat });
