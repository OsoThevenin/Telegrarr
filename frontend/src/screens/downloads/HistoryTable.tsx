import { ArrowDown, ArrowUp } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useI18n } from "@/i18n/use-i18n";
import { downloadName, downloadSource, type Download } from "@/lib/downloads";
import { DownloadActions } from "@/screens/downloads/DownloadActions";
import { DownloadNotes } from "@/screens/downloads/DownloadNotes";
import type { SortOrder } from "@/screens/downloads/download-list";
import { formatSize, fullDateTime, relativeTime } from "@/screens/downloads/format";
import type { DownloadSelection } from "@/screens/downloads/use-download-selection";

type Direction = "ascending" | "descending";

/** A column the shared sort can order by: the order it shows as, and the one a click picks. */
type SortableColumn = {
  directionOf: (sort: SortOrder) => Direction | undefined;
  next: (sort: SortOrder) => SortOrder;
};

const BY_NAME: SortableColumn = {
  directionOf: (sort) => (sort === "name" ? "ascending" : undefined),
  next: () => "name",
};
const BY_SIZE: SortableColumn = {
  directionOf: (sort) => (sort === "big" ? "descending" : undefined),
  next: () => "big",
};
const BY_DATE: SortableColumn = {
  directionOf: (sort) => (sort === "new" ? "descending" : sort === "old" ? "ascending" : undefined),
  next: (sort) => (sort === "new" ? "old" : "new"),
};

type HeadProps = {
  label: string;
  column?: SortableColumn;
  sort: SortOrder;
  onSortChange: (sort: SortOrder) => void;
};

function ColumnHead({ label, column, sort, onSortChange }: HeadProps) {
  if (!column) {
    return (
      <TableHead scope="col" className="text-muted-foreground">
        {label}
      </TableHead>
    );
  }
  const direction = column.directionOf(sort);
  const Arrow = direction === "ascending" ? ArrowUp : ArrowDown;

  return (
    <TableHead scope="col" aria-sort={direction} className="text-muted-foreground">
      <button
        type="button"
        onClick={() => onSortChange(column.next(sort))}
        className="-mx-1 inline-flex items-center gap-1 rounded-sm px-1 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 data-active:text-foreground"
        data-active={direction ? "" : undefined}
      >
        {label}
        <Arrow aria-hidden="true" className={direction ? "size-3.5" : "size-3.5 opacity-0"} />
      </button>
    </TableHead>
  );
}

type RowProps = {
  download: Download;
  selection: DownloadSelection;
};

function HistoryRow({ download, selection }: RowProps) {
  const { t, locale } = useI18n();
  const name = downloadName(download);
  const isSelected = selection.isSelected(download.id);
  const { finished_at, file_size } = download;

  return (
    <TableRow data-state={isSelected ? "selected" : undefined}>
      <TableCell className="w-10 pl-3 align-top">
        <Checkbox
          aria-label={t("dl.select_download", { name })}
          checked={isSelected}
          onCheckedChange={(checked) => selection.toggle(download.id, checked === true)}
          className="mt-0.5 after:-inset-3.5"
        />
      </TableCell>
      <TableCell className="w-full max-w-0 py-2.5 align-top whitespace-normal">
        <p className="font-medium wrap-anywhere" title={download.save_path ?? undefined}>
          {name}
        </p>
        <DownloadNotes download={download} />
      </TableCell>
      <TableCell className="max-w-48 truncate align-top text-muted-foreground" title={downloadSource(download)}>
        {downloadSource(download) || "—"}
      </TableCell>
      <TableCell className="align-top text-muted-foreground tabular-nums">{file_size ? formatSize(file_size) : "—"}</TableCell>
      <TableCell className="align-top text-muted-foreground tabular-nums">
        {finished_at ? <span title={fullDateTime(finished_at, locale)}>{relativeTime(finished_at, locale)}</span> : "—"}
      </TableCell>
      <TableCell className="py-1.5 pr-3 align-top">
        <div className="flex justify-end">
          <DownloadActions download={download} />
        </div>
      </TableCell>
    </TableRow>
  );
}

type Props = {
  rows: readonly Download[];
  sort: SortOrder;
  onSortChange: (sort: SortOrder) => void;
  selection: DownloadSelection;
};

/** Failed and cancelled rows on a wide screen: one line each, in columns that sort. */
export function HistoryTable({ rows, sort, onSortChange, selection }: Props) {
  const { t } = useI18n();
  const head = { sort, onSortChange };

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead scope="col" className="w-10 pl-3">
              <span className="sr-only">{t("dl.col.select")}</span>
            </TableHead>
            <ColumnHead label={t("dl.col.file")} column={BY_NAME} {...head} />
            <ColumnHead label={t("dl.col.channel")} {...head} />
            <ColumnHead label={t("dl.col.size")} column={BY_SIZE} {...head} />
            <ColumnHead label={t("dl.col.when")} column={BY_DATE} {...head} />
            <TableHead scope="col" className="pr-3">
              <span className="sr-only">{t("dl.col.actions")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((download) => (
            <HistoryRow key={download.id} download={download} selection={selection} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
