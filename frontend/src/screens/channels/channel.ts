/** A row of GET /api/channels: one source, which is a chat or one topic of a forum group. */
export type Channel = {
  id: number;
  chat_id: number;
  title: string;
  kind: string;
  /** SQLite flags: 0 or 1. */
  enabled: number;
  scanning: number;
  forum: number;
  topic_id: number | null;
  topic_title: string | null;
  imdb_id: string | null;
  imdb_title: string | null;
  tmdb_id: number | null;
  tvdb_id: number | null;
  weekdays: string;
  poll_minutes: number;
  language: string;
  fallback_quality: string;
  history: {
    read: number;
    total_estimate: number | null;
    complete: boolean;
    next_batch_at: number | null;
  };
};

/** One card of the grid: the sources that feed one title. */
export type Show = {
  key: string;
  /** The source that names the show and holds its mapping, shared by all its sources. */
  lead: Channel;
  sources: Channel[];
};

export type ChannelTab = "series" | "movies";

export const isMovieChannel = (channel: Channel) => channel.kind === "movie";

/** Every kind but movie lands on the series tab, so no channel falls out of the grid. */
export const tabOf = (channel: Channel): ChannelTab => (isMovieChannel(channel) ? "movies" : "series");

const showKey = (channel: Channel) =>
  channel.imdb_id?.trim() || channel.imdb_title?.trim() || `ch:${channel.id}`;

/** Sources sharing a mapping make one show, in the order the API lists them. */
export function groupIntoShows(channels: Channel[]): Show[] {
  const keys = [...new Set(channels.map(showKey))];

  return keys.map((key) => {
    const sources = channels.filter((channel) => showKey(channel) === key);
    return { key, lead: sources[0], sources };
  });
}

/** How a source is named: its chat, plus the topic for a topic source. */
export const sourceLabel = (channel: Channel) =>
  channel.topic_title ? `${channel.title} › ${channel.topic_title}` : channel.title;

export const showTitle = ({ lead }: Show) => lead.imdb_title || sourceLabel(lead);

export const isWholeForum = (channel: Channel) => Boolean(channel.forum) && channel.topic_id == null;

const MAX_INITIALS = 2;

/** Up to two initials from the words that start with a letter or a digit. */
export function initialsOf(title: string): string {
  const words = title.match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}'’]*/gu) ?? [];
  const letters = words.slice(0, MAX_INITIALS).map((word) => Array.from(word)[0]);

  return letters.join("").toLocaleUpperCase() || "?";
}
