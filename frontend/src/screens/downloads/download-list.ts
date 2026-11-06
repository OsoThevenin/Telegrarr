import { downloadName, downloadSource, type Download } from "@/lib/downloads";

export type DownloadStatus = Download["status"];

export type DownloadTab = {
  id: string;
  labelKey: string;
  statuses: readonly DownloadStatus[];
};

export const ACTIVE_TAB: DownloadTab = {
  id: "active",
  labelKey: "dl.tab.active",
  // A row paused on its own has nowhere else to be: it is held, not finished.
  statuses: ["downloading", "queued", "paused"],
};
export const COMPLETED_TAB: DownloadTab = {
  id: "completed",
  labelKey: "dash.stat.completed",
  statuses: ["completed"],
};
export const FAILED_TAB: DownloadTab = { id: "failed", labelKey: "dash.stat.failed", statuses: ["failed"] };
export const CANCELLED_TAB: DownloadTab = { id: "cancelled", labelKey: "dl.cancelled", statuses: ["cancelled"] };

export const DOWNLOAD_TABS = [ACTIVE_TAB, COMPLETED_TAB, FAILED_TAB, CANCELLED_TAB] as const;

const RETRYABLE: readonly DownloadStatus[] = ["failed", "cancelled"];

/** The rows not finished yet: Stop can act on them, and there is nothing to delete yet. */
export const isInTransfer = ({ status }: Download): boolean => ACTIVE_TAB.statuses.includes(status);

/** The rows Retry can act on; the server enforces the same rule. */
export const isRetryable = ({ status }: Download): boolean => RETRYABLE.includes(status);

export const rowsOfTab = (rows: readonly Download[], { statuses }: DownloadTab): Download[] =>
  rows.filter(({ status }) => statuses.includes(status));

const SHOW_FOLDER = /\/([^/]+)\/Season\s[^/]*\/[^/]*$/i;

/** The show a finished file belongs to: its library folder, else where it came from. */
export const showName = (download: Download): string =>
  download.save_path?.match(SHOW_FOLDER)?.[1] ?? downloadSource(download);

export type DownloadGroup = {
  name: string;
  rows: Download[];
};

/** One group per show, by name; rows keep the order they came in. */
export function groupByShow(rows: readonly Download[], unknownName: string): DownloadGroup[] {
  const nameOf = (download: Download): string => showName(download) || unknownName;
  const names = [...new Set(rows.map(nameOf))].toSorted((a, b) => a.localeCompare(b));
  return names.map((name) => ({ name, rows: rows.filter((download) => nameOf(download) === name) }));
}

export function matchesFilter(download: Download, filter: string): boolean {
  const wanted = filter.trim().toLowerCase();
  return [downloadName(download), downloadSource(download)].some((text) => text.toLowerCase().includes(wanted));
}

const newestFirst = (a: Download, b: Download): number => moment(b) - moment(a);
const moment = ({ finished_at, created_at }: Download): number => finished_at || created_at || 0;

export const SORT_ORDERS = [
  { id: "new", labelKey: "dl.sort.new", compare: newestFirst },
  { id: "old", labelKey: "dl.sort.old", compare: (a: Download, b: Download) => newestFirst(b, a) },
  { id: "big", labelKey: "dl.sort.big", compare: (a: Download, b: Download) => (b.file_size || 0) - (a.file_size || 0) },
  {
    id: "name",
    labelKey: "dl.sort.name",
    compare: (a: Download, b: Download) => downloadName(a).localeCompare(downloadName(b)),
  },
] as const;

export type SortOrder = (typeof SORT_ORDERS)[number]["id"];

export const DEFAULT_SORT: SortOrder = "new";

export const isSortOrder = (value: string | null): value is SortOrder => SORT_ORDERS.some(({ id }) => id === value);

const transferRank = ({ status }: Download): number => ACTIVE_TAB.statuses.indexOf(status);

/** In the chosen order; within a tab of mixed states, what is running comes first. */
export function sortRows(rows: readonly Download[], order: SortOrder): Download[] {
  const { compare } = SORT_ORDERS.find(({ id }) => id === order) ?? SORT_ORDERS[0];
  return rows.toSorted(compare).toSorted((a, b) => transferRank(a) - transferRank(b));
}
