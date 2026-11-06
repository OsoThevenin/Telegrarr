import type { PendingRelease } from "./review-api";

export type Filters = {
  query: string;
  channelId: number | null;
  reason: string | null;
};

export type ChannelFacet = { channelId: number; title: string; count: number };
export type ReasonFacet = { reason: string; count: number };

export const NO_FILTERS: Filters = { query: "", channelId: null, reason: null };

const COMBINING_MARKS = /\p{Mn}/gu;
const INTERPUNCT = /·/g;
const WORD_SEPARATORS = /[._\-\s]+/g;

/** So "els pirates" finds `Els.Pirates.CAT.mkv`, and "catala" finds "català". */
function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .replace(INTERPUNCT, "")
    .replace(WORD_SEPARATORS, " ")
    .toLowerCase()
    .trim();
}

function matchesQuery(release: PendingRelease, query: string): boolean {
  const needle = normalize(query);
  if (!needle) return true;
  return [release.file_name, release.caption, release.parsed_title].some(
    (text) => text != null && normalize(text).includes(needle),
  );
}

export function applyFilters(releases: PendingRelease[], filters: Filters): PendingRelease[] {
  return releases.filter(
    (release) =>
      (filters.channelId === null || release.channel_id === filters.channelId) &&
      (filters.reason === null || release.reason === filters.reason) &&
      matchesQuery(release, filters.query),
  );
}

/** A filter on a channel or reason that has left the queue no longer narrows anything. */
export function withoutVanished(releases: PendingRelease[], filters: Filters): Filters {
  const hasChannel = releases.some((release) => release.channel_id === filters.channelId);
  const hasReason = releases.some((release) => release.reason === filters.reason);
  return {
    query: filters.query,
    channelId: hasChannel ? filters.channelId : null,
    reason: hasReason ? filters.reason : null,
  };
}

/** Counts each channel under the search and the reason, so a count predicts its option's result. */
export function channelFacets(releases: PendingRelease[], filters: Filters): ChannelFacet[] {
  const candidates = applyFilters(releases, { ...filters, channelId: null });
  const titles = new Map(releases.map((release) => [release.channel_id, release.channel_title]));
  return [...titles]
    .map(([channelId, title]) => ({
      channelId,
      title,
      count: candidates.filter((release) => release.channel_id === channelId).length,
    }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

/** Counts each reason under the search and the channel. */
export function reasonFacets(releases: PendingRelease[], filters: Filters): ReasonFacet[] {
  const candidates = applyFilters(releases, { ...filters, reason: null });
  const reasons = [...new Set(releases.map((release) => release.reason))].sort();
  return reasons.map((reason) => ({
    reason,
    count: candidates.filter((release) => release.reason === reason).length,
  }));
}
