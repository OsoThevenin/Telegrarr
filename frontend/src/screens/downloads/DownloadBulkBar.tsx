import { useRef, type ReactNode } from "react";

import { ConfirmTrigger } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useI18n } from "@/i18n/use-i18n";
import type { Download } from "@/lib/downloads";
import { isInTransfer, isPausable, isPaused, isRetryable } from "@/screens/downloads/download-list";
import { useDownloadActions } from "@/screens/downloads/use-download-actions";
import type { DownloadSelection } from "@/screens/downloads/use-download-selection";

const isDeletable = (download: Download): boolean => !isInTransfer(download);

type Props = {
  /** The rows of the tab, which Select all takes in. */
  rows: readonly Download[];
  selection: DownloadSelection;
  /** What applies to the tab whatever is selected, at the right of the row. */
  children?: ReactNode;
};

type BulkActionProps = {
  label: string;
  hint?: string;
  ids: number[];
  isPending: boolean;
  onRun: (ids: number[]) => void;
};

function BulkAction({ label, hint, ids, isPending, onRun }: BulkActionProps) {
  if (ids.length === 0) return null;
  return (
    <Button variant="quiet" size="sm" title={hint} disabled={isPending} onClick={() => onRun(ids)}>
      {label}
    </Button>
  );
}

type ActionsProps = {
  selected: readonly Download[];
  onDone: () => void;
};

/** Each action is offered when the selection allows it, and sends only the rows it can act on. */
function BulkActions({ selected, onDone }: ActionsProps) {
  const { t } = useI18n();
  const { isPending, pauseMany, resumeMany, retryMany, removeMany } = useDownloadActions();
  const idsOf = (canAct: (download: Download) => boolean) => selected.filter(canAct).map(({ id }) => id);
  const deletable = idsOf(isDeletable);

  return (
    <>
      <BulkAction
        label={t("dl.pause")}
        hint={t("dl.pause_hint")}
        ids={idsOf(isPausable)}
        isPending={isPending}
        onRun={(ids) => pauseMany(ids, onDone)}
      />
      <BulkAction
        label={t("dl.resume")}
        hint={t("dl.resume_hint")}
        ids={idsOf(isPaused)}
        isPending={isPending}
        onRun={(ids) => resumeMany(ids, onDone)}
      />
      <BulkAction
        label={t("dl.retry")}
        ids={idsOf(isRetryable)}
        isPending={isPending}
        onRun={(ids) => retryMany(ids, onDone)}
      />
      {deletable.length > 0 && (
        <ConfirmTrigger
          trigger={
            <Button variant="destructive" size="sm" disabled={isPending}>
              {t("common.delete")}
            </Button>
          }
          title={t("common.delete")}
          description={t("dl.delete_selected_confirm", { n: deletable.length })}
          confirmLabel={t("common.delete")}
          isDestructive
          onConfirm={async () => removeMany(deletable, onDone)}
        />
      )}
    </>
  );
}

/** Stays under the shell's header, so the actions are at hand anywhere in a long list. Select all shows only when there are rows. */
export function DownloadBulkBar({ rows, selection, children }: Props) {
  const { t, tn } = useI18n();
  const selectAll = useRef<HTMLButtonElement>(null);
  const { selected, toggleAll, clear } = selection;
  const count = selected.length;

  // The button that had focus goes with the selection, so it lands somewhere stable.
  const handleDone = () => {
    clear();
    selectAll.current?.focus();
  };

  return (
    <div className="sticky top-14 z-5 flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-2 bg-background py-1 pl-3">
      {rows.length > 0 && (
        <div role="group" aria-label={t("dl.bulk_bar")} className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Checkbox
            ref={selectAll}
            aria-label={t("dl.select_all")}
            checked={count === rows.length || (count > 0 && "indeterminate")}
            onCheckedChange={(checked) => toggleAll(checked === true)}
            className="after:-inset-3.5"
          />
          <span aria-live="polite" className="text-sm text-muted-foreground tabular-nums">
            {count > 0 ? tn("dl.selected_n", count) : t("dl.select_all")}
          </span>
          <BulkActions selected={selected} onDone={handleDone} />
          {count > 0 && (
            <Button variant="quiet" size="sm" onClick={handleDone}>
              {t("dl.clear_selection")}
            </Button>
          )}
        </div>
      )}
      <div className="ml-auto flex flex-wrap items-center justify-end gap-2">{children}</div>
    </div>
  );
}
