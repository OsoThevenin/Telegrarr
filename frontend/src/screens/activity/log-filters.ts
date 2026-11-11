import type { LogEntry } from "@/screens/activity/log";

export type LogLevelFilter = "ALL" | "ERROR" | "WARN" | "INFO";

export type LogFilters = {
  level: LogLevelFilter;
  channelId: number | null;
  query: string;
};

export type LogChannelFacet = { channelId: number; title: string; count: number };

export const ALL_LEVELS: LogLevelFilter = "ALL";

export const NO_LOG_FILTERS: LogFilters = { level: ALL_LEVELS, channelId: null, query: "" };

function matches(entry: LogEntry, { level, channelId, query }: LogFilters): boolean {
  const needle = query.trim().toLowerCase();
  return (
    (level === ALL_LEVELS || entry.level === level) &&
    (channelId === null || entry.channelId === channelId) &&
    (!needle || entry.text.toLowerCase().includes(needle))
  );
}

export function applyLogFilters(entries: readonly LogEntry[], filters: LogFilters): LogEntry[] {
  return entries.filter((entry) => matches(entry, filters));
}

export function isFiltering({ level, channelId, query }: LogFilters): boolean {
  return level !== ALL_LEVELS || channelId !== null || query.trim() !== "";
}

/**
 * The channels the log mentions, each counted under the level and the search, so a count
 * predicts its option's result. A channel the log names but `titles` no longer knows is left out.
 */
export function logChannelFacets(
  entries: readonly LogEntry[],
  filters: LogFilters,
  titles: ReadonlyMap<number, string>,
): LogChannelFacet[] {
  const candidates = applyLogFilters(entries, { ...filters, channelId: null });
  const channelIds = [...new Set(entries.map((entry) => entry.channelId))];
  return channelIds
    .filter((channelId): channelId is number => channelId !== null && titles.has(channelId))
    .map((channelId) => ({
      channelId,
      title: titles.get(channelId) ?? "",
      count: candidates.filter((entry) => entry.channelId === channelId).length,
    }))
    .sort((a, b) => a.title.localeCompare(b.title));
}
