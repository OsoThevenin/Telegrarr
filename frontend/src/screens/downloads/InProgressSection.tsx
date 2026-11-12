import { useId, type ReactNode } from "react";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n/use-i18n";
import type { Download } from "@/lib/downloads";
import { statusQuery } from "@/lib/status";
import { PHONE_QUERY, useMediaQuery } from "@/lib/use-media-query";
import { DownloadBulkBar } from "@/screens/downloads/DownloadBulkBar";
import { DownloadList } from "@/screens/downloads/DownloadList";
import { IN_PROGRESS_ID, isInTransfer, splitInProgress } from "@/screens/downloads/download-list";
import { PauseAllButton } from "@/screens/downloads/PauseAllButton";
import { QueueFold } from "@/screens/downloads/QueueFold";
import { useDownloadSelection } from "@/screens/downloads/use-download-selection";

/** On a phone, the cards before the queue line: more would push the history off the screen. */
const PHONE_CARDS = 2;

type Props = {
  /** Every row that passes the filter: the section keeps the ones not finished yet. */
  rows: readonly Download[];
  query: UseQueryResult<Download[]>;
  isFiltered: boolean;
  isDense: boolean;
};

type HeaderProps = {
  headingId: string;
  /** What sits at the right of the heading when there is no Select all row to hold it. */
  children?: ReactNode;
};

function SectionHeader({ headingId, children }: HeaderProps) {
  const { t } = useI18n();
  const { data: status } = useQuery(statusQuery);
  const speed = status?.speed;

  return (
    <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1">
      <h2 id={headingId} className="text-base font-semibold">
        {t("dl.in_progress")}
      </h2>
      {Boolean(speed) && <span className="text-sm font-medium text-primary tabular-nums">{speed?.toFixed(1)} MB/s</span>}
      {children}
    </div>
  );
}

function SectionBody({ rows, isDense }: Pick<Props, "rows" | "isDense">) {
  const { tn } = useI18n();
  const isPhone = useMediaQuery(PHONE_QUERY);
  const selection = useDownloadSelection(rows);
  const { transfers, queued } = splitInProgress(rows);

  const cards = isPhone ? transfers.slice(0, PHONE_CARDS) : transfers;
  const folded = [...transfers.slice(cards.length), ...queued];
  const foldLabel = folded.length === queued.length ? tn("dl.queue_n", folded.length) : tn("dl.more_n", folded.length);

  return (
    <>
      <DownloadBulkBar rows={rows} selection={selection}>
        <PauseAllButton />
      </DownloadBulkBar>
      {cards.length > 0 && <DownloadList rows={cards} isDense={isDense} selection={selection} />}
      {folded.length > 0 && <QueueFold rows={folded} label={foldLabel} selection={selection} />}
    </>
  );
}

/** What is moving or waiting, always above the history: a long queue folds away instead of pushing it down. */
export function InProgressSection({ rows, query, isFiltered, isDense }: Props) {
  const { t } = useI18n();
  const headingId = useId();
  const inProgress = rows.filter(isInTransfer);

  // Nothing in progress (or nothing to say yet): the section is one quiet line, with the queue's switch in reach.
  const isQuiet = !query.isPending && inProgress.length === 0;

  return (
    <section id={IN_PROGRESS_ID} aria-labelledby={headingId} className="flex scroll-mt-16 flex-col gap-2">
      <SectionHeader headingId={headingId}>
        {isQuiet && (
          <>
            {query.data && (
              <p className="text-sm text-muted-foreground">{isFiltered ? t("dl.nothing_in_progress_matches") : t("dl.nothing_in_progress")}</p>
            )}
            <div className="ml-auto">
              <PauseAllButton />
            </div>
          </>
        )}
      </SectionHeader>
      {query.isPending && <Skeleton aria-hidden="true" className="h-16 rounded-lg" />}
      {!query.isPending && !isQuiet && <SectionBody rows={inProgress} isDense={isDense} />}
    </section>
  );
}
