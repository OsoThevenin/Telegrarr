import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { isSeriesKind, type Channel } from "@/screens/channels/channel";
import type { ChannelSettings } from "@/screens/channels/channel-settings";
import { CHANNELS_KEY } from "@/screens/channels/queries";
import type { TopicTicks } from "@/screens/channels/TopicPicker";
import type { ForumTopic, PickedChat } from "@/screens/channels/telegram-queries";
import type { SeriesPayload } from "@/screens/channels/use-series-mapping";

/** What is read from the chat: all of it, or one topic of a forum group. */
export type SourceTarget = { kind: string; topic_id?: number; topic_title?: string };

export type AddRequest = {
  chat: PickedChat;
  settings: ChannelSettings;
  targets: SourceTarget[];
  /** Applied to the target that is a series; there is at most one when this is set. */
  mapping: SeriesPayload | null;
};

export type AddFailure = { target: SourceTarget; error: unknown };
export type AddResult = { added: Channel[]; failures: AddFailure[] };

export const topicTargets = (topics: ForumTopic[], ticks: TopicTicks): SourceTarget[] =>
  topics
    .filter(({ topic_id }) => ticks[topic_id] !== undefined)
    .map(({ topic_id, title }) => ({ kind: ticks[topic_id], topic_id, topic_title: title }));

async function addSource({ chat, settings, mapping }: AddRequest, target: SourceTarget): Promise<Channel> {
  const row = await api.post<Channel>("/api/channels", {
    chat_id: chat.chat_id,
    title: chat.title,
    ...settings,
    ...target,
  });

  return mapping && isSeriesKind(target.kind) ? api.put<Channel>(`/api/channels/${row.id}/series`, mapping) : row;
}

/** One at a time, and past failures: saving again updates what already went in. */
async function addSources(request: AddRequest): Promise<AddResult> {
  let result: AddResult = { added: [], failures: [] };

  for (const target of request.targets) {
    try {
      const row = await addSource(request, target);
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
