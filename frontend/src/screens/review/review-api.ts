import { api, ApiError } from "@/lib/api";

export type PendingRelease = {
  channel_id: number;
  message_id: number;
  parsed_title: string | null;
  year: number | null;
  file_name: string | null;
  caption: string | null;
  size: number | null;
  reason: string;
  channel_title: string;
  topic_title: string | null;
};

export type FilmHit = {
  tmdb_id: number;
  title: string;
  original_title: string | null;
  year: number | null;
};

/** A search pick, or whatever the user typed: a TMDB id, a TMDB link or an IMDb id. */
export type FilmChoice = { tmdb_id: number } | { typed_id: string };

export type BulkFailure = { release: PendingRelease; error: unknown };

export type BulkOutcome = {
  discarded: PendingRelease[];
  /** Already resolved elsewhere: nothing to retry. */
  gone: PendingRelease[];
  failures: BulkFailure[];
};

export const PENDING_KEY = ["review"];

const releasePath = (release: PendingRelease): string =>
  `/api/review/${release.channel_id}/${release.message_id}`;

export const releaseKey = (release: PendingRelease): string =>
  `${release.channel_id}:${release.message_id}`;

export const fetchPending = (): Promise<PendingRelease[]> => api.get<PendingRelease[]>("/api/review");

export const searchFilms = (query: string): Promise<FilmHit[]> =>
  api.get<FilmHit[]>(`/api/tmdb/movies?q=${encodeURIComponent(query)}`);

export const assignRelease = (release: PendingRelease, choice: FilmChoice): Promise<{ title: string }> =>
  api.post<{ title: string }>(`${releasePath(release)}/assign`, choice);

export const discardRelease = (release: PendingRelease): Promise<unknown> =>
  api.post(`${releasePath(release)}/discard`);

/** The backend's own "already resolved" answer: a bare 404 from a proxy is a real failure. */
export function isNotPending(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.status !== 404) return false;
  return typeof error.detail === "object" && error.detail.key === "err.review.not_pending";
}

/** There is no bulk endpoint: one POST per release, each free to fail on its own. */
export async function discardAll(releases: PendingRelease[]): Promise<BulkOutcome> {
  const results = await Promise.allSettled(releases.map(discardRelease));
  const rejections = results.flatMap((result, index): BulkFailure[] =>
    result.status === "rejected" ? [{ release: releases[index], error: result.reason }] : [],
  );
  return {
    discarded: releases.filter((_, index) => results[index].status === "fulfilled"),
    gone: rejections.filter(({ error }) => isNotPending(error)).map(({ release }) => release),
    failures: rejections.filter(({ error }) => !isNotPending(error)),
  };
}
