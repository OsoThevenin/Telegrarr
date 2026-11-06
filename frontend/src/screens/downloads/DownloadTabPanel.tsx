import type { UseQueryResult } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n/use-i18n";
import type { Download } from "@/lib/downloads";
import { CompletedGroups } from "@/screens/downloads/CompletedGroups";
import { ConfirmClear } from "@/screens/downloads/ConfirmClear";
import { DownloadBulkBar } from "@/screens/downloads/DownloadBulkBar";
import { DownloadList } from "@/screens/downloads/DownloadList";
import {
  ACTIVE_TAB,
  COMPLETED_TAB,
  FAILED_TAB,
  sortRows,
  type DownloadTab,
  type SortOrder,
} from "@/screens/downloads/download-list";
import { useDownloadActions } from "@/screens/downloads/use-download-actions";
import { useDownloadSelection } from "@/screens/downloads/use-download-selection";

const SKELETON_ROWS = 3;

function LoadingRows() {
  const { t } = useI18n();

  return (
    <div role="status" aria-label={t("common.loading")} className="flex flex-col gap-2">
      {Array.from({ length: SKELETON_ROWS }, (_, row) => (
        <Skeleton key={row} className="h-16 rounded-lg" />
      ))}
    </div>
  );
}

type ListFailureProps = {
  error: unknown;
  onRefetch: () => void;
};

function ListFailure({ error, onRefetch }: ListFailureProps) {
  const { t, errorText } = useI18n();

  return (
    <div className="flex flex-col items-start gap-2">
      <p role="alert" className="text-destructive">
        {errorText(error)}
      </p>
      <Button variant="outline" onClick={onRefetch}>
        {t("common.refresh")}
      </Button>
    </div>
  );
}

function emptyText(tab: DownloadTab, t: (key: string) => string): string {
  if (tab === ACTIVE_TAB) return t("dl.no_active");
  return tab === COMPLETED_TAB ? t("dl.nothing_downloaded") : t("dl.nothing_here");
}

type ClearFailedProps = {
  /** The failed rows in view: Clear never reaches past the filter. */
  rows: readonly Download[];
};

function ClearFailed({ rows }: ClearFailedProps) {
  const { t } = useI18n();
  const { isPending, removeMany } = useDownloadActions();
  const n = rows.length;

  return (
    <div className="flex justify-end">
      <ConfirmClear
        trigger={
          <Button variant="outline" size="sm" disabled={isPending}>
            {t("dl.clear_failed", { n })}
          </Button>
        }
        title={t("dl.clear_failed", { n })}
        message={t("dl.delete_failed_confirm", { n })}
        onConfirm={() => removeMany(rows.map(({ id }) => id))}
      />
    </div>
  );
}

type Props = {
  tab: DownloadTab;
  /** The rows of this tab that pass the filter. */
  rows: readonly Download[];
  query: UseQueryResult<Download[]>;
  isFiltered: boolean;
  sort: SortOrder;
  isDense: boolean;
};

export function DownloadTabPanel({ tab, rows, query, isFiltered, sort, isDense }: Props) {
  const { t } = useI18n();
  const selection = useDownloadSelection(rows);

  if (query.isPending) return <LoadingRows />;
  if (query.isError && !query.data) return <ListFailure error={query.error} onRefetch={() => void query.refetch()} />;
  if (rows.length === 0) {
    return <p className="py-8 text-center text-muted-foreground">{isFiltered ? t("dl.no_matches") : emptyText(tab, t)}</p>;
  }

  const sortedRows = sortRows(rows, sort);
  // A filter looks for files, so it opens the show folders up into a flat list.
  const isGrouped = tab === COMPLETED_TAB && !isFiltered;
  const List = isGrouped ? CompletedGroups : DownloadList;

  return (
    <div className="flex flex-col gap-2">
      <DownloadBulkBar rows={rows} selection={selection}>
        {tab === FAILED_TAB && <ClearFailed rows={rows} />}
      </DownloadBulkBar>
      <List rows={sortedRows} isDense={isDense} selection={selection} />
    </div>
  );
}
