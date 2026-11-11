import { useId, useState } from "react";

import { ChevronDown } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { useI18n } from "@/i18n/use-i18n";
import { downloadName, downloadSource, type Download } from "@/lib/downloads";
import { cn } from "@/lib/utils";
import { DownloadActions } from "@/screens/downloads/DownloadActions";
import { isQueued } from "@/screens/downloads/download-list";
import { formatSize } from "@/screens/downloads/format";
import { StatusPill } from "@/screens/downloads/StatusPill";
import type { DownloadSelection } from "@/screens/downloads/use-download-selection";

type RowProps = {
  download: Download;
  selection: DownloadSelection;
};

/** One line per waiting row: nothing has moved yet, so there is no progress to show. */
function QueuedRow({ download, selection }: RowProps) {
  const { t } = useI18n();
  const name = downloadName(download);
  const isSelected = selection.isSelected(download.id);
  const source = downloadSource(download);

  return (
    <li className={cn("flex min-h-11 items-center gap-3 px-3 py-1", isSelected && "bg-primary/5")}>
      <Checkbox
        aria-label={t("dl.select_download", { name })}
        checked={isSelected}
        onCheckedChange={(checked) => selection.toggle(download.id, checked === true)}
        className="after:-inset-3.5"
      />
      <p className="min-w-0 flex-1 truncate text-sm font-medium" title={name}>
        {name}
      </p>
      <span className="hidden shrink-0 text-sm whitespace-nowrap text-muted-foreground tabular-nums md:inline">
        {[source, download.file_size ? formatSize(download.file_size) : null].filter(Boolean).join(" · ")}
      </span>
      {!isQueued(download) && <StatusPill status={download.status} />}
      <DownloadActions download={download} />
    </li>
  );
}

type Props = {
  /** What does not get a card: the queue, and on a phone the transfers past the first few. */
  rows: readonly Download[];
  /** "N a la cua", or "N més" when transfers fold in too. */
  label: string;
  selection: DownloadSelection;
};

/** The queue, folded into one line so a long one never pushes the history down; opened, it scrolls within itself. */
export function QueueFold({ rows, label, selection }: Props) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const listId = useId();

  return (
    <div className="rounded-lg border bg-card">
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={listId}
        onClick={() => setIsOpen(!isOpen)}
        className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="font-medium tabular-nums">{label}</span>{" "}
        <span aria-hidden="true" className="text-muted-foreground">
          ·
        </span>{" "}
        <span className="text-muted-foreground">{isOpen ? t("dl.hide") : t("dl.show")}</span>
        <ChevronDown
          aria-hidden="true"
          className={cn("size-4 text-muted-foreground transition-transform motion-reduce:transition-none", isOpen && "rotate-180")}
        />
      </button>
      <div id={listId} hidden={!isOpen}>
        {isOpen && (
          <ul aria-label={label} className="max-h-68 divide-y overflow-y-auto overscroll-contain border-t">
            {rows.map((download) => (
              <QueuedRow key={download.id} download={download} selection={selection} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
