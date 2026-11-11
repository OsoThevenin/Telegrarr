import type { UseQueryResult } from "@tanstack/react-query";

import { ConfirmTrigger } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { NARROW_QUERY, useMediaQuery } from "@/lib/use-media-query";
import { useI18n } from "@/i18n/use-i18n";
import type { Download } from "@/lib/downloads";
import { CompletedGroups } from "@/screens/downloads/CompletedGroups";
import { DownloadBulkBar } from "@/screens/downloads/DownloadBulkBar";
import { DownloadList } from "@/screens/downloads/DownloadList";
import { HistoryTable } from "@/screens/downloads/HistoryTable";
import { COMPLETED_TAB, FAILED_TAB, sortRows, type DownloadTab, type SortOrder } from "@/screens/downloads/download-list";
import { useDownloadActions } from "@/screens/downloads/use-download-actions";
import { useDownloadSelection, type DownloadSelection } from "@/screens/downloads/use-download-selection";

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

const emptyText = (tab: DownloadTab, t: (key: string) => string): string =>
  tab === COMPLETED_TAB ? t("dl.nothing_downloaded") : t("dl.nothing_here");

type ClearFailedProps = {
  /** The failed rows in view: Clear never reaches past the filter. */
  rows: readonly Download[];
};

function ClearFailed({ rows }: ClearFailedProps) {
  const { t, tn } = useI18n();
  const { isPending, removeMany } = useDownloadActions();
  const n = rows.length;
  const label = tn("dl.clear_failed", n);

  return (
    <ConfirmTrigger
      trigger={
        <Button variant="quiet" size="sm" disabled={isPending}>
          {label}
        </Button>
      }
      title={label}
      description={t("dl.delete_failed_confirm", { n })}
      confirmLabel={t("common.delete")}
      isDestructive
      onConfirm={async () => removeMany(rows.map(({ id }) => id))}
    />
  );
}

type Props = {
  tab: DownloadTab;
  /** The rows of this tab that pass the filter. */
  rows: readonly Download[];
  query: UseQueryResult<Download[]>;
  isFiltered: boolean;
  sort: SortOrder;
  onSortChange: (sort: SortOrder) => void;
  isDense: boolean;
};

type BodyProps = Omit<Props, "rows" | "tab"> & {
  tab: DownloadTab;
  rows: readonly Download[];
  selection: DownloadSelection;
};

function PanelBody({ tab, rows, query, isFiltered, sort, onSortChange, isDense, selection }: BodyProps) {
  const { t } = useI18n();
  const isNarrow = useMediaQuery(NARROW_QUERY);

  if (query.isPending) return <LoadingRows />;
  if (query.isError && !query.data) return <ListFailure error={query.error} onRefetch={() => void query.refetch()} />;
  if (rows.length === 0) {
    return <p className="py-8 text-center text-muted-foreground">{isFiltered ? t("dl.no_matches") : emptyText(tab, t)}</p>;
  }

  const sorted = sortRows(rows, sort);
  // Failed and cancelled rows read as a table where there is room for its columns.
  if (tab !== COMPLETED_TAB && !isNarrow) {
    return <HistoryTable rows={sorted} sort={sort} onSortChange={onSortChange} selection={selection} />;
  }
  // A filter looks for files, so it opens the show folders up into a flat list.
  const isGrouped = tab === COMPLETED_TAB && !isFiltered;
  const List = isGrouped ? CompletedGroups : DownloadList;
  return <List rows={sorted} isDense={isDense} selection={selection} />;
}

/** A history tab: its Select all row, then its rows. The queue's switch lives in En curs, not here. */
export function DownloadTabPanel(props: Props) {
  const { tab, rows } = props;
  const selection = useDownloadSelection(rows);

  return (
    <div className="flex flex-col gap-2">
      <DownloadBulkBar rows={rows} selection={selection}>
        {tab === FAILED_TAB && rows.length > 0 && <ClearFailed rows={rows} />}
      </DownloadBulkBar>
      <PanelBody {...props} selection={selection} />
    </div>
  );
}
