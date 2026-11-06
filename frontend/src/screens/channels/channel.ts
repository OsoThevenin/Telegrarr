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
  /** Unix seconds; 0 until the first scan. */
  last_scanned_at: number;
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

export const MOVIE_KIND = "movie";

export const isMovieChannel = (channel: Channel) => channel.kind === MOVIE_KIND;

/** The one kind a series mapping applies to. */
export const isSeriesKind = (kind: string) => kind === "tv";

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

/** The ids a series mapping holds, as the mapping line spells them; empty when unmapped. */
export const mappingIds = ({ tvdb_id, tmdb_id, imdb_id }: Channel) =>
  [tvdb_id && `TVDB ${tvdb_id}`, tmdb_id && `TMDB ${tmdb_id}`, imdb_id && `IMDb ${imdb_id}`]
    .filter(Boolean)
    .join(" · ");

type Translate = (key: string, params?: Record<string, unknown>) => string;

/** A kind this release does not know is shown as it stands. */
export function kindLabel(kind: string, t: Translate): string {
  if (kind === "tv") return t("kind.tv");
  return kind === "movie" ? t("kind.movie") : kind;
}

/** A kind as a choice on a form. */
export function kindChoiceLabel(kind: string, t: Translate): string {
  if (kind === "tv") return t("chm.kind.tv");
  return kind === "movie" ? t("chm.kind.movie") : kind;
}

function weekdaysLabel(weekdays: string, t: Translate): string {
  const names = t("common.weekdays_short").split(" ");
  const days = weekdays.split(",").filter(Boolean).map(Number);
  if (days.length === names.length) return t("common.every_day");
  return days.map((day) => names[day]).join(" ") || "—";
}

/** When a source is read: its days and its polling interval. */
export const scheduleLabel = ({ weekdays, poll_minutes }: Channel, t: Translate) =>
  `${weekdaysLabel(weekdays, t)} · ${t("common.minutes_short", { n: poll_minutes })}`;

const MAX_INITIALS = 2;

/** Up to two initials from the words that start with a letter or a digit. */
export function initialsOf(title: string): string {
  const words = title.match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}'’]*/gu) ?? [];
  const letters = words.slice(0, MAX_INITIALS).map((word) => Array.from(word)[0]);

  return letters.join("").toLocaleUpperCase() || "?";
}
