import { downloadName, downloadSource, type Download } from "@/lib/downloads";

export type DownloadStatus = Download["status"];

export type DownloadTab = {
  id: string;
  labelKey: string;
  statuses: readonly DownloadStatus[];
};

/** What is not finished yet, in the order it reads in En curs. A row paused on its own is held, not finished. */
const IN_TRANSFER: readonly DownloadStatus[] = ["downloading", "paused", "queued"];

/** The En curs section's anchor, for links that lead straight to it. */
export const IN_PROGRESS_ID = "en-curs";

export const COMPLETED_TAB: DownloadTab = {
  id: "completed",
  labelKey: "dash.stat.completed",
  statuses: ["completed"],
};
export const FAILED_TAB: DownloadTab = { id: "failed", labelKey: "dash.stat.failed", statuses: ["failed"] };
export const CANCELLED_TAB: DownloadTab = { id: "cancelled", labelKey: "dl.cancelled", statuses: ["cancelled"] };

/** The history under En curs. The old Active tab is gone: a link to it opens the default one. */
export const HISTORY_TABS = [COMPLETED_TAB, FAILED_TAB, CANCELLED_TAB] as const;
export const DEFAULT_TAB = COMPLETED_TAB;

/** The tab a URL names, if it names one. */
export const tabFromUrl = (id: unknown): string | undefined => HISTORY_TABS.find((tab) => tab.id === id)?.id;

const RETRYABLE: readonly DownloadStatus[] = ["failed", "cancelled"];
const PAUSABLE: readonly DownloadStatus[] = ["downloading", "queued"];

/** The rows not finished yet: Stop can act on them, and there is nothing to delete yet. */
export const isInTransfer = ({ status }: Download): boolean => IN_TRANSFER.includes(status);

/** The rows Retry can act on; the server enforces the same rule. */
export const isRetryable = ({ status }: Download): boolean => RETRYABLE.includes(status);

/** The rows Pause can act on; the server enforces the same rule. */
export const isPausable = ({ status }: Download): boolean => PAUSABLE.includes(status);

/** A row held on its own, with no partial file: Resume starts it from the beginning. */
export const isPaused = ({ status }: Download): boolean => status === "paused";

export const isQueued = ({ status }: Download): boolean => status === "queued";

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

export function sortRows(rows: readonly Download[], order: SortOrder): Download[] {
  const { compare } = SORT_ORDERS.find(({ id }) => id === order) ?? SORT_ORDERS[0];
  return rows.toSorted(compare);
}

const transferRank = ({ status }: Download): number => IN_TRANSFER.indexOf(status);

export type InProgress = {
  /** Running, then paused: each one a full card. */
  transfers: Download[];
  /** Waiting, in the order the queue will start them. */
  queued: Download[];
};

/** The rows of En curs, split into what shows as a card and what folds into the queue line. */
export function splitInProgress(rows: readonly Download[]): InProgress {
  const inTransfer = rows.filter(isInTransfer).toSorted((a, b) => transferRank(a) - transferRank(b) || a.id - b.id);
  return { transfers: inTransfer.filter((row) => !isQueued(row)), queued: inTransfer.filter(isQueued) };
}
