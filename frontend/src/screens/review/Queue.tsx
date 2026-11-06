import { useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useI18n } from "@/i18n/use-i18n";

import { BulkDiscard } from "./BulkDiscard";
import { applyFilters, NO_FILTERS, withoutVanished } from "./filters";
import { InlineAlert } from "./InlineAlert";
import { ReleaseRow } from "./ReleaseRow";
import { releaseName } from "./release-text";
import {
  PENDING_KEY,
  releaseKey,
  type BulkFailure,
  type BulkOutcome,
  type PendingRelease,
} from "./review-api";
import { ReviewFilters } from "./ReviewFilters";

type OpenRow = { key: string; shouldFocusSearch: boolean };

type Props = {
  releases: PendingRelease[];
  onNotice: (notice: string) => void;
};

/** The row to carry on with once `key` leaves the list: the one below it, or else above. */
function rowAfter(shown: PendingRelease[], key: string): string | null {
  const keys = shown.map(releaseKey);
  const index = keys.indexOf(key);
  return keys[index + 1] ?? keys[index - 1] ?? null;
}

function updateSelection(
  selection: ReadonlySet<string>,
  keys: string[],
  isSelected: boolean,
): ReadonlySet<string> {
  if (isSelected) return new Set([...selection, ...keys]);
  return new Set([...selection].filter((key) => !keys.includes(key)));
}

function NoMatches({ onClear }: { onClear: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-start gap-2 py-6">
      <p className="text-sm">{t("review.no_matches")}</p>
      <Button type="button" variant="outline" size="sm" onClick={onClear}>
        {t("review.clear_filters")}
      </Button>
    </div>
  );
}

type ToolbarProps = {
  shownCount: number;
  shownSelectedCount: number;
  totalCount: number;
  onToggleAllShown: (isSelected: boolean) => void;
  children: ReactNode;
};

/** Stays under the shell's header, so the bulk action is at hand anywhere in a long queue. */
function Toolbar({ shownCount, shownSelectedCount, totalCount, onToggleAllShown, children }: ToolbarProps) {
  const { t } = useI18n();
  const isAllSelected = shownCount > 0 && shownSelectedCount === shownCount;
  return (
    <div className="sticky top-14 z-5 flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-2 bg-background py-1 pl-3">
      <span className="flex items-center gap-3 text-sm text-muted-foreground tabular-nums">
        <Checkbox
          aria-label={t("review.select_all")}
          checked={isAllSelected || (shownSelectedCount > 0 && "indeterminate")}
          disabled={shownCount === 0}
          onCheckedChange={(checked) => onToggleAllShown(checked === true)}
          className="after:-inset-3.5"
        />
        {t("review.shown_of", { shown: shownCount, total: totalCount })}
      </span>
      {children}
    </div>
  );
}

function FailureReport({ failures, onDismiss }: { failures: BulkFailure[]; onDismiss: () => void }) {
  const { t, tn, errorText } = useI18n();
  return (
    <InlineAlert actionLabel={t("common.close")} onAction={onDismiss}>
      <p className="font-medium">{tn("review.bulk_failed", failures.length)}</p>
      <ul className="mt-1 wrap-anywhere">
        {failures.map(({ release, error }) => (
          <li key={releaseKey(release)}>{`${releaseName(release, t)}: ${errorText(error)}`}</li>
        ))}
      </ul>
    </InlineAlert>
  );
}

type ReleaseListProps = {
  shown: PendingRelease[];
  selection: ReadonlySet<string>;
  open: OpenRow | null;
  onSelect: (key: string, isSelected: boolean) => void;
  onOpen: (row: OpenRow | null) => void;
  onResolved: (key: string, notice: string) => void;
};

function ReleaseList({ shown, selection, open, onSelect, onOpen, onResolved }: ReleaseListProps) {
  const { t } = useI18n();
  return (
    <ul aria-label={t("review.list")} className="rounded-lg border">
      {shown.map((release) => {
        const key = releaseKey(release);
        const isOpen = key === open?.key;
        return (
          <ReleaseRow
            key={key}
            release={release}
            isOpen={isOpen}
            isSelected={selection.has(key)}
            shouldFocusSearch={isOpen && open.shouldFocusSearch}
            onToggleSelected={(isSelected) => onSelect(key, isSelected)}
            onToggleOpen={() => onOpen(isOpen ? null : { key, shouldFocusSearch: false })}
            onResolved={(notice) => onResolved(key, notice)}
          />
        );
      })}
    </ul>
  );
}

function useDropFromQueue() {
  const queryClient = useQueryClient();
  return (keys: ReadonlySet<string>) => {
    queryClient.setQueryData<PendingRelease[]>(PENDING_KEY, (current) =>
      current?.filter((release) => !keys.has(releaseKey(release))),
    );
    void queryClient.invalidateQueries({ queryKey: PENDING_KEY });
  };
}

function bulkNotice({ discarded, gone }: BulkOutcome, tn: (key: string, count: number) => string) {
  const notices = [
    discarded.length > 0 ? tn("review.bulk_discarded", discarded.length) : "",
    gone.length > 0 ? tn("review.bulk_gone", gone.length) : "",
  ];
  return notices.filter(Boolean).join(" · ");
}

type RowsProps = Props & {
  shown: PendingRelease[];
  onClearFilters: () => void;
};

function Rows({ releases, shown, onNotice, onClearFilters }: RowsProps) {
  const { tn } = useI18n();
  const dropFromQueue = useDropFromQueue();
  const [open, setOpen] = useState<OpenRow | null>(null);
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [failures, setFailures] = useState<BulkFailure[]>([]);

  const selected = releases.filter((release) => selection.has(releaseKey(release)));
  const shownSelected = shown.filter((release) => selection.has(releaseKey(release)));

  function handleResolved(key: string, notice: string) {
    const next = rowAfter(shown, key);
    onNotice(notice);
    setOpen(next ? { key: next, shouldFocusSearch: true } : null);
    dropFromQueue(new Set([key]));
  }

  function handleBulkSettled(outcome: BulkOutcome) {
    const doneKeys = [...outcome.discarded, ...outcome.gone].map(releaseKey);
    onNotice(bulkNotice(outcome, tn));
    setFailures(outcome.failures);
    setSelection((current) => updateSelection(current, doneKeys, false));
    dropFromQueue(new Set(doneKeys));
  }

  return (
    <>
      {failures.length > 0 && <FailureReport failures={failures} onDismiss={() => setFailures([])} />}
      <Toolbar
        shownCount={shown.length}
        shownSelectedCount={shownSelected.length}
        totalCount={releases.length}
        onToggleAllShown={(isSelected) =>
          setSelection(updateSelection(selection, shown.map(releaseKey), isSelected))
        }
      >
        {selected.length > 0 && (
          <BulkDiscard
            selected={selected}
            hiddenCount={selected.length - shownSelected.length}
            onClear={() => setSelection(new Set())}
            onStart={() => setFailures([])}
            onSettled={handleBulkSettled}
          />
        )}
      </Toolbar>
      {shown.length === 0 ? (
        <NoMatches onClear={onClearFilters} />
      ) : (
        <ReleaseList
          shown={shown}
          selection={selection}
          open={open}
          onSelect={(key, isSelected) => setSelection(updateSelection(selection, [key], isSelected))}
          onOpen={setOpen}
          onResolved={handleResolved}
        />
      )}
    </>
  );
}

export function Queue({ releases, onNotice }: Props) {
  const [requestedFilters, setFilters] = useState(NO_FILTERS);
  const filters = withoutVanished(releases, requestedFilters);
  return (
    <div className="flex flex-col gap-3">
      <ReviewFilters releases={releases} filters={filters} onChange={setFilters} />
      <Rows
        releases={releases}
        shown={applyFilters(releases, filters)}
        onNotice={onNotice}
        onClearFilters={() => setFilters(NO_FILTERS)}
      />
    </div>
  );
}
