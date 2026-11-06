import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { DOWNLOADS_KEY, type Download } from "@/lib/downloads";
import { isMovieChannel, type Channel, type Show } from "@/screens/channels/channel";
import type { ChannelSettings } from "@/screens/channels/channel-settings";
import type { SeriesPayload } from "@/screens/channels/use-series-mapping";

export const CHANNELS_KEY = ["channels"] as const;

/** TMDB art barely changes, and each lookup costs the backend a TMDB call. */
export const ART_STALE_MS = 60 * 60 * 1000;
/** How much of a Catalog is searched for a card's poster; most rows are identified. */
const CATALOG_SAMPLE = 8;

/** What GET /api/art knows about a title. The backend leaves out what TMDB lacks. */
export type Art = {
  poster?: string | null;
  backdrop?: string | null;
  overview?: string | null;
  year?: string | number | null;
  rating?: number | null;
};

type CatalogSample = { rows: { tmdb_id?: number | null }[] };
type CatalogPosters = { posters: Record<string, string | null> };

/** A finished row of GET /api/downloads, as far as the Sheet reads it. */
export type CompletedDownload = Pick<Download, "id" | "channel_id" | "file_name" | "file_size"> & {
  save_path: string | null;
  finished_at: number | null;
};

export const useChannels = () =>
  useQuery({ queryKey: CHANNELS_KEY, queryFn: () => api.get<Channel[]>("/api/channels") });

type ChannelUpdate = { id: number; fields: ChannelSettings; mapping: SeriesPayload | null };

async function updateChannel({ id, fields, mapping }: ChannelUpdate): Promise<void> {
  await api.patch(`/api/channels/${id}`, fields);
  if (mapping) await api.put(`/api/channels/${id}/series`, mapping);
}

export function useUpdateChannel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateChannel,
    // On failure too: the settings may have saved before the mapping failed.
    onSettled: () => queryClient.invalidateQueries({ queryKey: CHANNELS_KEY }),
  });
}

/** The endpoint has no channel filter and caps at 1000, newest first, across every channel. */
export const useCompletedDownloads = () =>
  useQuery({
    queryKey: [...DOWNLOADS_KEY, "completed"],
    queryFn: () => api.get<CompletedDownload[]>("/api/downloads?status=completed&limit=1000"),
  });

export const useArt = (imdbId: string | null) =>
  useQuery({
    queryKey: ["art", imdbId],
    queryFn: () => api.get<Art>(`/api/art?imdb=${encodeURIComponent(imdbId ?? "")}`),
    enabled: Boolean(imdbId),
    staleTime: ART_STALE_MS,
  });

async function fetchCatalogPoster(channelId: number): Promise<string | null> {
  const { rows } = await api.get<CatalogSample>(`/api/channels/${channelId}/catalog?limit=${CATALOG_SAMPLE}`);
  const ids = rows.flatMap(({ tmdb_id }) => (tmdb_id ? [tmdb_id] : []));
  if (ids.length === 0) return null;

  const query = new URLSearchParams(ids.map((id) => ["ids", String(id)]));
  const { posters } = await api.get<CatalogPosters>(`/api/channels/${channelId}/catalog/posters?${query}`);
  return ids.map((id) => posters[id]).find(Boolean) ?? null;
}

/** The poster a show's card leads with: its mapping's, else one from its movie Catalog. */
export function useShowPoster({ lead }: Show): string | null {
  const art = useArt(lead.imdb_id);
  const artSettled = !lead.imdb_id || art.isFetched;
  const catalog = useQuery({
    queryKey: ["catalog-poster", lead.id],
    queryFn: () => fetchCatalogPoster(lead.id),
    enabled: isMovieChannel(lead) && artSettled && !art.data?.poster,
    staleTime: ART_STALE_MS,
  });

  return art.data?.poster ?? catalog.data ?? null;
}
