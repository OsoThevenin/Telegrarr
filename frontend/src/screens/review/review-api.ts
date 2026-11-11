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

/** A TMDB search hit. `year` and `poster` come as "" when TMDB has none. */
export type FilmHit = {
  tmdb_id: number;
  title: string;
  original_title: string | null;
  year: string;
  poster: string;
  overview?: string;
};

/** What a TMDB id, TMDB link or IMDb id names, resolved before assigning it. */
export type FilmPreview = FilmHit & { imdb_id: string | null };

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

/** The stream doesn't signal new releases, and reading the queue costs only the database. */
export const PENDING_REFRESH_MS = 30_000;

const releasePath = (release: PendingRelease): string =>
  `/api/review/${release.channel_id}/${release.message_id}`;

export const releaseKey = (release: PendingRelease): string =>
  `${release.channel_id}:${release.message_id}`;

export const fetchPending = (): Promise<PendingRelease[]> => api.get<PendingRelease[]>("/api/review");

const searchFilmsIn = (query: string, year: number | null): Promise<FilmHit[]> => {
  const params = new URLSearchParams(year ? { q: query, year: String(year) } : { q: query });
  return api.get<FilmHit[]>(`/api/tmdb/movies?${params}`);
};

/** Searches the release's year first, as it narrows TMDB best; then any year when that finds nothing. */
export async function searchFilms(query: string, year: number | null = null): Promise<FilmHit[]> {
  const hits = await searchFilmsIn(query, year);
  return hits.length > 0 || !year ? hits : searchFilmsIn(query, null);
}

/** Read-only: names the film without assigning it. */
export const previewFilm = (typed: string | number): Promise<FilmPreview> =>
  api.get<FilmPreview>(`/api/tmdb/movie?id=${encodeURIComponent(String(typed))}`);

export const tmdbFilmUrl = (tmdbId: number): string => `https://www.themoviedb.org/movie/${tmdbId}`;

export const imdbFilmUrl = (imdbId: string): string => `https://www.imdb.com/title/${imdbId}/`;

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
