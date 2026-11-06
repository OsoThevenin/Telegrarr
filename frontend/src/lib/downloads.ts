/** A row of GET /api/downloads, or of `active` in the live stream. */
export type Download = {
  id: number;
  channel_id: number;
  file_name: string | null;
  file_size: number | null;
  status: "queued" | "downloading" | "paused" | "completed" | "failed" | "cancelled";
  /** From 0 to 100. */
  progress: number;
  speed_mbs: number;
  channel_title: string | null;
  topic_title: string | null;
};

/** The prefix of every query that holds a list of downloads. */
export const DOWNLOADS_KEY = ["downloads"] as const;
