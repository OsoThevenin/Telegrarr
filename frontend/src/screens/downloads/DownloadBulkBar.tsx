import { useRef, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useI18n } from "@/i18n/use-i18n";
import type { Download } from "@/lib/downloads";
import { ConfirmClear } from "@/screens/downloads/ConfirmClear";
import { isInTransfer, isPausable, isPaused, isRetryable } from "@/screens/downloads/download-list";
import { useDownloadActions } from "@/screens/downloads/use-download-actions";
import type { DownloadSelection } from "@/screens/downloads/use-download-selection";

const isDeletable = (download: Download): boolean => !isInTransfer(download);

type Props = {
  /** The rows of the tab, which Select all takes in. */
  rows: readonly Download[];
  selection: DownloadSelection;
  /** What applies to the tab whatever is selected. */
  children?: ReactNode;
};

/**
 * Stays under the shell's header, so the actions are at hand anywhere in a long list.
 * Each action is offered when the selection allows it, and sends only the rows it can
 * act on, in one request.
 */
export function DownloadBulkBar({ rows, selection, children }: Props) {
  const { t, tn } = useI18n();
  const { isPending, pauseMany, resumeMany, retryMany, removeMany } = useDownloadActions();
  const selectAll = useRef<HTMLButtonElement>(null);
  const { selected, toggleAll, clear } = selection;

  const count = selected.length;
  const idsOf = (canAct: (download: Download) => boolean) => selected.filter(canAct).map(({ id }) => id);
  const pausable = idsOf(isPausable);
  const resumable = idsOf(isPaused);
  const retryable = idsOf(isRetryable);
  const deletable = idsOf(isDeletable);

  // The button that had focus goes with the selection, so it lands somewhere stable.
  const handleDone = () => {
    clear();
    selectAll.current?.focus();
  };

  return (
    <div className="sticky top-14 z-5 flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-2 bg-background py-1 pl-3">
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
        {pausable.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            title={t("dl.pause_hint")}
            disabled={isPending}
            onClick={() => pauseMany(pausable, handleDone)}
          >
            {t("dl.pause")}
          </Button>
        )}
        {resumable.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            title={t("dl.resume_hint")}
            disabled={isPending}
            onClick={() => resumeMany(resumable, handleDone)}
          >
            {t("dl.resume")}
          </Button>
        )}
        {retryable.length > 0 && (
          <Button variant="outline" size="sm" disabled={isPending} onClick={() => retryMany(retryable, handleDone)}>
            {t("dl.retry")}
          </Button>
        )}
        {deletable.length > 0 && (
          <ConfirmClear
            trigger={
              <Button variant="destructive" size="sm" disabled={isPending}>
                {t("common.delete")}
              </Button>
            }
            title={t("common.delete")}
            message={t("dl.delete_selected_confirm", { n: deletable.length })}
            onConfirm={() => removeMany(deletable, handleDone)}
          />
        )}
        {count > 0 && (
          <Button variant="ghost" size="sm" onClick={handleDone}>
            {t("dl.clear_selection")}
          </Button>
        )}
      </div>
      {children}
    </div>
  );
}
