/** What the Catalog decides, apart from how it looks. */

export const PAGE_SIZE = 25;

export type FilterId = "all" | "missing" | "downloaded" | "upgrade";

/** Rows per filter over the whole channel; the status filters are null until Radarr is read. */
export type CatalogCounts = { all: number } & Record<Exclude<FilterId, "all">, number | null>;

/** Radarr's view of a film, from GET …/catalog/status or a row of a status-filtered page. */
export type FilmStatus = {
  status: "missing" | "requested" | "downloaded" | "upgrade";
  /** The file Radarr holds. */
  radarr_quality?: string;
  /** The channel's best release, when it beats that file. */
  best_quality?: string;
};

export type FilmRow = Partial<FilmStatus> & {
  kind: "film";
  tmdb_id: number;
  imdb_id: string | null;
  title: string;
  year: number | null;
  quality: string;
  size: number;
  language: string;
};

/** A message waiting in Review. It has no film yet, so no tmdb_id and no Radarr status. */
export type UnidentifiedRow = {
  kind: "unidentified";
  review: { channel_id: number; message_id: number };
  title: string;
  quality: string;
  size: number;
  language: string;
};

export type CatalogRow = FilmRow | UnidentifiedRow;

/** A page of GET /api/channels/{id}/catalog. */
export type CatalogPage = {
  count: number;
  counts: CatalogCounts;
  rows: CatalogRow[];
};

export type StatusRow = FilmStatus & { tmdb_id: number; poster?: string };

/** GET /api/channels/{id}/catalog/status. It answers even when Radarr is down. */
export type CatalogStatus = {
  channel_id: number;
  radarr: { available: boolean; error: unknown };
  counts: CatalogCounts;
  rows: StatusRow[];
};

export type CatalogView = {
  q: string;
  filter: FilterId;
  page: number;
};

export const isFilm = (row: CatalogRow): row is FilmRow => row.kind === "film";

const FILTERS = [
  { id: "all", labelKey: "cat.filter_all" },
  { id: "missing", labelKey: "cat.filter_missing" },
  { id: "downloaded", labelKey: "cat.filter_downloaded" },
  { id: "upgrade", labelKey: "cat.filter_upgrade" },
] as const;

const UNKNOWN_COUNT = "–";
const PENDING_COUNT = "…";

/** `isAvailable` is null while Radarr is being checked. */
export function chipStates(counts: CatalogCounts | undefined, isAvailable: boolean | null, pressed: FilterId) {
  return FILTERS.map(({ id, labelKey }) => {
    const count = counts?.[id];
    const needsRadarr = id !== "all";
    const isKnown = count != null && (!needsRadarr || isAvailable === true);
    const placeholder = isAvailable === null ? PENDING_COUNT : UNKNOWN_COUNT;

    return {
      id,
      labelKey,
      count: isKnown ? String(count) : placeholder,
      isPressed: id === pressed,
      isDisabled: needsRadarr && isAvailable !== true,
    };
  });
}

export type FilmAction =
  | { kind: "get"; isDisabled: boolean }
  | { kind: "upgrade"; from?: string; to?: string }
  | { kind: "requested" };

/** What a row offers for a film's status, or null when the film needs nothing. */
export function filmAction(status: FilmStatus | undefined, isAvailable: boolean): FilmAction | null {
  if (status?.status === "requested") return { kind: "requested" };
  if (!isAvailable) return { kind: "get", isDisabled: true };
  if (status?.status === "missing") return { kind: "get", isDisabled: false };
  if (status?.status === "upgrade") return { kind: "upgrade", from: status.radarr_quality, to: status.best_quality };
  return null;
}

/** The status once Radarr accepted the request: an upgrade keeps both its qualities. */
export const requestedStatus = <Status extends FilmStatus>(status: Status): Status => ({
  ...status,
  status: "requested",
});

export function withRequested(answer: CatalogStatus, tmdbId: number): CatalogStatus {
  const isKnown = answer.rows.some((row) => row.tmdb_id === tmdbId);
  const rows = answer.rows.map((row) => (row.tmdb_id === tmdbId ? requestedStatus(row) : row));

  return { ...answer, rows: isKnown ? rows : [...rows, { tmdb_id: tmdbId, status: "requested" }] };
}

export function pageUrl(channelId: number, { q, filter, page }: CatalogView): string {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (q) params.set("q", q);
  if (filter !== "all") params.set("filter", filter);
  if (page > 1) params.set("offset", String((page - 1) * PAGE_SIZE));

  return `/api/channels/${channelId}/catalog?${params}`;
}

export const pageCount = (rows: number) => Math.max(1, Math.ceil(rows / PAGE_SIZE));

/** Pages between two kept ones that are worth a gap; a single page is shown instead. */
const SMALLEST_GAP = 2;

/** The page numbers to offer: the ends and the current page's neighbours. */
export function pageNumbers(current: number, total: number): (number | "gap")[] {
  const kept = [...new Set([1, current - 1, current, current + 1, total])]
    .filter((page) => page >= 1 && page <= total)
    .toSorted((a, b) => a - b);

  return kept.flatMap((page, index) => {
    const skipped = index === 0 ? 0 : page - kept[index - 1] - 1;
    if (skipped === 0) return [page];
    return skipped < SMALLEST_GAP ? [page - 1, page] : ["gap" as const, page];
  });
}

/** Which rows of the result a page shows, as "26–50". */
export function shownRange(page: number, rowsOnPage: number): string {
  const first = (page - 1) * PAGE_SIZE + 1;
  return `${first}–${first + rowsOnPage - 1}`;
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"];
const BYTES_PER_UNIT = 1024;

export function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const exponent = Math.floor(Math.log(bytes) / Math.log(BYTES_PER_UNIT));
  const unit = Math.min(BYTE_UNITS.length - 1, exponent);

  return `${(bytes / BYTES_PER_UNIT ** unit).toFixed(unit ? 1 : 0)} ${BYTE_UNITS[unit]}`;
}
