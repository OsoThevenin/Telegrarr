import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { Channel } from "@/screens/channels/channel";
import type { ChannelSettings } from "@/screens/channels/channel-settings";
import { CHANNELS_KEY } from "@/screens/channels/queries";
import type { PickedChat } from "@/screens/channels/telegram-queries";

/** What is read from the chat: all of it, or one topic of a forum group. */
export type SourceTarget = { kind: string };

export type AddRequest = {
  chat: PickedChat;
  settings: ChannelSettings;
  targets: SourceTarget[];
};

export type AddFailure = { target: SourceTarget; error: unknown };
export type AddResult = { added: Channel[]; failures: AddFailure[] };

/** One at a time, and past failures: saving again updates what already went in. */
async function addSources({ chat, settings, targets }: AddRequest): Promise<AddResult> {
  let result: AddResult = { added: [], failures: [] };

  for (const target of targets) {
    try {
      const row = await api.post<Channel>("/api/channels", {
        chat_id: chat.chat_id,
        title: chat.title,
        ...settings,
        ...target,
      });
      result = { ...result, added: [...result.added, row] };
    } catch (error) {
      result = { ...result, failures: [...result.failures, { target, error }] };
    }
  }

  return result;
}

export function useAddChannel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: addSources,
    onSettled: () => queryClient.invalidateQueries({ queryKey: CHANNELS_KEY }),
  });
}
