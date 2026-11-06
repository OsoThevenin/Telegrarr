import { queryOptions } from "@tanstack/react-query";

import { api, type ServerMessage } from "@/lib/api";
import { withTopic } from "@/lib/format";

/** The API's own ceiling on one list of downloads. */
export const MAX_DOWNLOADS = 1000;

/** A row of GET /api/downloads, or of `active` in the live stream. */
export type Download = {
  id: number;
  channel_id: number;
  file_name: string | null;
  file_size: number | null;
  status: "queued" | "downloading" | "paused" | "completed" | "failed" | "cancelled";
  /** From 0 to 1. */
  progress: number;
  speed_mbs: number;
  save_path: string | null;
  finished_at: number | null;
  channel_title: string | null;
  topic_title: string | null;
  /** In seconds since the epoch. */
  created_at?: number;
  /** Legacy rows keep plain text here; newer ones say why in `error_msg`. */
  error?: string | null;
  error_msg?: ServerMessage | null;
  episode?: number | null;
  /** The channel's own number, when the episode was resolved or checked. */
  parsed_episode?: number | null;
  episode_source?: string | null;
};

/** The prefix of every query that holds a list of downloads. */
export const DOWNLOADS_KEY = ["downloads"] as const;

/** Every state at once, so the tabs can count without a request each. */
export const downloadsQuery = queryOptions({
  queryKey: [...DOWNLOADS_KEY, { limit: MAX_DOWNLOADS }],
  queryFn: () => api.get<Download[]>(`/api/downloads?limit=${MAX_DOWNLOADS}`),
});

/** The name a person knows a download by: the file as saved, once it has a place. */
export function downloadName({
  save_path: savePath,
  file_name: fileName,
}: Pick<Download, "save_path" | "file_name">): string {
  return savePath?.split("/").pop() || fileName || "";
}

/** The Channel a download came from, with its topic in a forum group. */
export function downloadSource({ channel_title: channelTitle, topic_title: topic }: Download): string {
  return withTopic(channelTitle ?? "", topic);
}
