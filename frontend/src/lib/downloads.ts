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
};

/** The prefix of every query that holds a list of downloads. */
export const DOWNLOADS_KEY = ["downloads"] as const;

/** The name a person knows a download by: the file as saved, once it has a place. */
export function downloadName({ save_path: savePath, file_name: fileName }: Download): string {
  return savePath?.split("/").pop() || fileName || "";
}

/** The Channel a download came from, with its topic in a forum group. */
export function downloadSource({ channel_title: title, topic_title: topic }: Download): string {
  return topic ? `${title} › ${topic}` : (title ?? "");
}
