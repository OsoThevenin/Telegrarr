import { http, HttpResponse } from "msw";

import type {
  CatalogRow,
  FilmRow,
  FilmStatus,
  FilterId,
  RadarrFile,
  StatusRow,
  UnidentifiedRow,
} from "@/screens/channels/catalog/catalog";
import { server } from "@/test/server";

const GB = 1024 ** 3;

export const CHANNEL_ID = 7;
const CATALOG_URL = `/api/channels/${CHANNEL_ID}/catalog`;

export const film = (tmdbId: number, fields: Partial<FilmRow> = {}): FilmRow => ({
  kind: "film",
  tmdb_id: tmdbId,
  imdb_id: `tt${tmdbId}`,
  title: `Film ${tmdbId}`,
  year: 2020,
  quality: "1080p",
  size: 2 * GB,
  language: "CAT",
  radarr_link: null,
  ...fields,
});

/** The file Radarr holds for a film, as app/catalog.py reports it. */
export const radarrFile = (fields: Partial<RadarrFile> = {}): RadarrFile => ({
  quality: "Bluray-1080p",
  resolution: "1920x1080",
  video_codec: "x265",
  container: "mkv",
  audio_languages: ["Català", "English"],
  subtitle_languages: ["Español"],
  size: 2.5 * GB,
  ...fields,
});

export const unidentified = (messageId: number, title: string): UnidentifiedRow => ({
  kind: "unidentified",
  review: { channel_id: CHANNEL_ID, message_id: messageId },
  title,
  quality: "720p",
  size: GB,
  language: "CAT",
});

/** As app/catalog.py keeps a status per filter. */
const KEEPS: Record<Exclude<FilterId, "all">, (status: FilmStatus) => boolean> = {
  missing: ({ status }) => status === "missing",
  downloaded: ({ radarr_quality }) => radarr_quality !== undefined,
  upgrade: ({ status }) => status === "upgrade",
};
const FILTERS = Object.keys(KEEPS) as (keyof typeof KEEPS)[];

const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();

const NO_LIMIT_GIVEN = 50;
const NO_COUNTS = { all: 0, missing: null, downloaded: null, upgrade: null };

/** A movie channel's Catalog with nothing in it, for tests about the Sheet around it. */
export const emptyCatalog = (channelId: number) => [
  http.get(`/api/channels/${channelId}/catalog`, () =>
    HttpResponse.json({ count: 0, counts: NO_COUNTS, rows: [] }),
  ),
  http.get(`/api/channels/${channelId}/catalog/status`, () =>
    HttpResponse.json({
      channel_id: channelId,
      radarr: { available: false, error: null },
      counts: NO_COUNTS,
      rows: [],
    }),
  ),
];

type World = {
  rows: CatalogRow[];
  statuses: Record<number, FilmStatus>;
  isRadarrUp: boolean;
  isListDown: boolean;
};

/** A fake of the Catalog's three reads that pages, searches and filters as the backend does. */
export function serveCatalog(rows: CatalogRow[], statuses: Record<number, FilmStatus> = {}, isRadarrUp = true) {
  const world: World = { rows, statuses, isRadarrUp, isListDown: false };
  const asked = { pages: [] as URLSearchParams[], status: 0, posters: [] as string[][], downloads: [] as number[] };

  const statusOf = (row: CatalogRow): FilmStatus =>
    row.kind === "film" ? (world.statuses[row.tmdb_id] ?? { status: "missing" }) : { status: "missing" };
  const films = () => world.rows.filter((row): row is FilmRow => row.kind === "film");
  const countOf = (filter: keyof typeof KEEPS) => films().filter((row) => KEEPS[filter](statusOf(row))).length;

  const counts = (readRadarr: boolean) => ({
    all: world.rows.length,
    ...Object.fromEntries(FILTERS.map((filter) => [filter, readRadarr ? countOf(filter) : null])),
  });

  server.use(
    http.get(CATALOG_URL, ({ request }) => {
      if (world.isListDown) return new HttpResponse(null, { status: 500 });
      const params = new URL(request.url).searchParams;
      asked.pages.push(params);
      const filter = (params.get("filter") ?? "all") as FilterId;
      const words = fold(params.get("q") ?? "").split(/\s+/).filter(Boolean);
      const limit = Number(params.get("limit") ?? NO_LIMIT_GIVEN);
      const offset = Number(params.get("offset") ?? 0);

      const kept: CatalogRow[] =
        filter === "all"
          ? world.rows
          : films()
              .filter((row) => KEEPS[filter](statusOf(row)))
              .map((row) => ({ ...row, ...statusOf(row) }));
      const matching = kept.filter(({ title }) => words.every((word) => fold(title).includes(word)));

      return HttpResponse.json({
        count: matching.length,
        counts: counts(filter !== "all"),
        rows: matching.slice(offset, offset + limit),
      });
    }),
    http.get(`${CATALOG_URL}/status`, () => {
      asked.status += 1;
      const available = world.isRadarrUp;
      const statusRows: StatusRow[] = films().map((row) => ({ tmdb_id: row.tmdb_id, ...statusOf(row) }));

      return HttpResponse.json({
        channel_id: CHANNEL_ID,
        radarr: { available, error: available ? null : { key: "err.arr.not_configured", params: {} } },
        counts: counts(available),
        rows: available ? statusRows : [],
      });
    }),
    http.get(`${CATALOG_URL}/posters`, ({ request }) => {
      const ids = new URL(request.url).searchParams.getAll("ids");
      asked.posters.push(ids);
      return HttpResponse.json({ posters: Object.fromEntries(ids.map((id) => [id, null])) });
    }),
    http.post(`${CATALOG_URL}/:tmdbId/download`, ({ params }) => {
      const tmdbId = Number(params.tmdbId);
      asked.downloads.push(tmdbId);
      world.statuses = { ...world.statuses, [tmdbId]: { ...world.statuses[tmdbId], status: "requested" } };
      return HttpResponse.json({ tmdb_id: tmdbId, action: "added" });
    }),
  );

  return { world, asked };
}
