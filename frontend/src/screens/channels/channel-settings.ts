import { isMovieChannel, type Channel } from "@/screens/channels/channel";

/** Account safety: mirrors config.POLL_FLOOR_MINUTES, which the server enforces. */
export const POLL_FLOOR_MINUTES = 15;

export const WEEKDAY_NUMBERS = [0, 1, 2, 3, 4, 5, 6];

/** What the settings form holds while it is being edited. */
export type SettingsForm = {
  kind: string;
  language: string;
  fallback_quality: string;
  days: number[];
  poll: string;
};

/** The fields PATCH /api/channels/{id} takes from the form. */
export type ChannelSettings = {
  kind: string;
  language: string;
  fallback_quality: string;
  weekdays: string;
  poll_minutes: number;
};

export const formOf = (channel: Channel): SettingsForm => ({
  kind: channel.kind,
  language: channel.language || "cat",
  fallback_quality: channel.fallback_quality || "1080p",
  days: channel.weekdays.split(",").filter(Boolean).map(Number),
  poll: String(Math.max(POLL_FLOOR_MINUTES, channel.poll_minutes)),
});

/** No day picked means every day, as in the previous interface. */
export function settingsOf({ days, poll, ...fields }: SettingsForm): ChannelSettings {
  const picked = days.length > 0 ? days : WEEKDAY_NUMBERS;

  return { ...fields, weekdays: picked.toSorted().join(","), poll_minutes: Number(poll) };
}

export const kindsFor = (channel: Channel) => {
  const isKnown = channel.kind === "tv" || isMovieChannel(channel);
  return isKnown ? ["tv", "movie"] : ["tv", "movie", channel.kind];
};
