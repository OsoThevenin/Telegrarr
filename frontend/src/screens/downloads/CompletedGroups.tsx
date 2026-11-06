import { useState } from "react";

import { ChevronRight, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/use-i18n";
import type { Download } from "@/lib/downloads";
import { cn } from "@/lib/utils";
import { ConfirmClear } from "@/screens/downloads/ConfirmClear";
import { DownloadList } from "@/screens/downloads/DownloadList";
import { groupByShow, type DownloadGroup } from "@/screens/downloads/download-list";
import { formatSize } from "@/screens/downloads/format";
import { useDownloadActions } from "@/screens/downloads/use-download-actions";

type CompletedGroupProps = {
  group: DownloadGroup;
  isDense: boolean;
};

function CompletedGroup({ group: { name, rows }, isDense }: CompletedGroupProps) {
  const { t, tn } = useI18n();
  const { isPending, removeMany } = useDownloadActions();
  const [isOpen, setIsOpen] = useState(false);

  const totalSize = rows.reduce((total, { file_size }) => total + (file_size || 0), 0);
  const clearLabel = t("dl.clear_group", { name });

  return (
    <li className="flex flex-col gap-2 rounded-lg border bg-card px-3 py-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          aria-expanded={isOpen}
          onClick={() => setIsOpen(!isOpen)}
        >
          <ChevronRight aria-hidden="true" className={cn("size-4 shrink-0 transition-transform", isOpen && "rotate-90")} />
          <span className="min-w-0">
            <span className="block font-medium wrap-anywhere">{name}</span>
            <span className="block text-sm text-muted-foreground">
              {tn("dl.episodes", rows.length)} · {formatSize(totalSize)}
            </span>
          </span>
        </button>
        <ConfirmClear
          trigger={
            <Button variant="ghost" size="icon-sm" title={clearLabel} aria-label={clearLabel} disabled={isPending}>
              <Trash2 aria-hidden="true" />
            </Button>
          }
          title={clearLabel}
          message={t("dl.clear_group_confirm", { n: rows.length, name })}
          onConfirm={() => removeMany(rows.map(({ id }) => id))}
        />
      </div>
      {isOpen && <DownloadList rows={rows} isDense={isDense} />}
    </li>
  );
}

type Props = {
  rows: readonly Download[];
  isDense: boolean;
};

export function CompletedGroups({ rows, isDense }: Props) {
  const { t } = useI18n();

  return (
    <ul className="flex flex-col gap-2">
      {groupByShow(rows, t("common.unknown")).map((group) => (
        <CompletedGroup key={group.name} group={group} isDense={isDense} />
      ))}
    </ul>
  );
}
