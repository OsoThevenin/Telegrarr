import { useEffect, useState } from "react";

import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import {
  isFilm,
  pageUrl,
  withRequested,
  type CatalogPage,
  type CatalogRow,
  type CatalogStatus,
  type CatalogView,
  type FilmRow,
  type StatusRow,
} from "@/screens/channels/catalog/catalog";
import { ART_STALE_MS } from "@/screens/channels/queries";

/** The stream doesn't signal new releases, and reading the list costs only the database. */
export const CATALOG_REFRESH_MS = 30_000;

// Not under ["channels"]: the live stream refetches that, and a Catalog refetch can read Radarr.
const catalogKey = (channelId: number) => ["catalog", channelId] as const;
const statusKey = (channelId: number) => [...catalogKey(channelId), "status"] as const;

/** A status filter reads Radarr on every fetch, so only the plain list refreshes by itself. */
export function useCatalogPage(channelId: number, view: CatalogView) {
  const readsRadarr = view.filter !== "all";

  return useQuery({
    queryKey: [...catalogKey(channelId), "page", view],
    queryFn: () => api.get<CatalogPage>(pageUrl(channelId, view)),
    placeholderData: keepPreviousData,
    refetchInterval: readsRadarr ? false : CATALOG_REFRESH_MS,
    refetchOnWindowFocus: !readsRadarr,
  });
}

/** Radarr's view of the channel: one Radarr read per opening, and one per change it must show. */
export function useCatalogStatus(channelId: number, rows: readonly CatalogRow[]) {
  const status = useQuery({
    queryKey: statusKey(channelId),
    queryFn: () => api.get<CatalogStatus>(`/api/channels/${channelId}/catalog/status`),
    refetchOnWindowFocus: false,
  });
  const { refetch } = status;

  const isAvailable = status.isPending ? null : Boolean(status.data?.radarr.available);
  const statuses = new Map((isAvailable ? (status.data?.rows ?? []) : []).map((row) => [row.tmdb_id, row]));

  // A film that arrived after the read has no status yet.
  const unknownFilms = rows.filter(isFilm).filter(({ tmdb_id }) => !statuses.has(tmdb_id));
  const unknownIds = unknownFilms.map(({ tmdb_id }) => tmdb_id).join();
  useEffect(() => {
    if (isAvailable && unknownIds) void refetch();
  }, [isAvailable, unknownIds, refetch]);

  return { isAvailable, statuses, counts: status.data?.counts, isChecking: status.isFetching };
}

type PosterAnswer = { posters: Record<string, string | null> };

/**
 * Radarr's posters come with the status. Once it answered, TMDB is asked for the rest of the
 * page, and a failure there just leaves the tiles: the Catalog never waits on art.
 */
export function useCatalogPosters(
  channelId: number,
  films: readonly FilmRow[],
  statuses: ReadonlyMap<number, StatusRow>,
  isStatusSettled: boolean,
): (tmdbId: number) => string | null {
  const ids = films.map(({ tmdb_id }) => tmdb_id).filter((id) => !statuses.get(id)?.poster);
  const tmdb = useQuery({
    queryKey: [...catalogKey(channelId), "posters", ids],
    queryFn: () => {
      const query = new URLSearchParams(ids.map((id) => ["ids", String(id)]));
      return api.get<PosterAnswer>(`/api/channels/${channelId}/catalog/posters?${query}`);
    },
    enabled: isStatusSettled && ids.length > 0,
    staleTime: ART_STALE_MS,
    retry: false,
  });

  return (tmdbId) => statuses.get(tmdbId)?.poster ?? tmdb.data?.posters[tmdbId] ?? null;
}

export type DownloadFailure = {
  film: FilmRow;
  error: unknown;
};

/** Download: the film turns Requested as soon as Radarr accepts, then the chips recount. */
export function useFilmDownload(channelId: number) {
  const queryClient = useQueryClient();
  const [pendingIds, setPendingIds] = useState<readonly number[]>([]);
  const [failure, setFailure] = useState<DownloadFailure | null>(null);

  const download = async (film: FilmRow) => {
    const { tmdb_id: tmdbId } = film;
    setFailure(null);
    setPendingIds((ids) => [...ids, tmdbId]);
    try {
      await api.post(`/api/channels/${channelId}/catalog/${tmdbId}/download`);
      queryClient.setQueryData<CatalogStatus>(
        statusKey(channelId),
        (answer) => answer && withRequested(answer, tmdbId),
      );
      void queryClient.invalidateQueries({ queryKey: statusKey(channelId) });
    } catch (error) {
      setFailure({ film, error });
    } finally {
      setPendingIds((ids) => ids.filter((id) => id !== tmdbId));
    }
  };

  return { download, pendingIds, failure, dismissFailure: () => setFailure(null) };
}
