import type { Channel } from "@/screens/channels/channel";

const NO_HISTORY = { read: 0, total_estimate: null, complete: false, next_batch_at: null };

/** A row of GET /api/channels, as SQLite gives it: flags are 0 or 1. */
export function channel(fields: Partial<Channel> & { id: number }): Channel {
  return {
    chat_id: -1000 - fields.id,
    title: `Canal ${fields.id}`,
    kind: "tv",
    enabled: 1,
    scanning: 1,
    forum: 0,
    topic_id: null,
    topic_title: null,
    imdb_id: null,
    imdb_title: null,
    tmdb_id: null,
    tvdb_id: null,
    weekdays: "0,1,2,3,4,5,6",
    poll_minutes: 30,
    language: "cat",
    fallback_quality: "1080p",
    history: NO_HISTORY,
    ...fields,
  };
}
