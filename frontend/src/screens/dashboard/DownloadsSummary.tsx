import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";

import { LoadError } from "@/components/LoadError";
import { Card } from "@/components/ui/card";
import { useI18n } from "@/i18n/use-i18n";
import { downloadName, type Download } from "@/lib/downloads";
import type { Status } from "@/lib/status";
import { activeDownloadQuery } from "@/screens/dashboard/dashboard-data";
import { Meter } from "@/screens/dashboard/Meter";

const SEPARATOR = " · ";

function ActiveTransfer({ download }: { download: Download }) {
  const name = downloadName(download);

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 truncate" title={name}>
          {name}
        </span>
        <span className="shrink-0 text-muted-foreground tabular-nums">{Math.round(download.progress * 100)}%</span>
      </div>
      <Meter label={name} ratio={download.progress} />
    </div>
  );
}

/** What is happening on Downloads, in a line or two. The queue itself lives there. */
export function DownloadsSummary({ status }: { status: Status }) {
  const { t } = useI18n();
  const { downloading, queued } = status.stats;
  const active = useQuery(activeDownloadQuery);
  const transfer = active.data?.find((download) => download.status === "downloading");

  const isIdle = downloading === 0 && queued === 0;
  const parts = [
    t("dash.summary.active", { n: downloading }),
    ...(status.speed ? [`${status.speed.toFixed(1)} MB/s`] : []),
    t("dash.summary.queued", { n: queued }),
  ];

  return (
    <Card size="sm" className="gap-3 px-3">
      <Link
        to="/downloads"
        className="flex items-center justify-between gap-3 rounded-sm text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <span className="min-w-0">{isIdle ? t("dash.idle") : parts.join(SEPARATOR)}</span>
        <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      </Link>
      {transfer && <ActiveTransfer download={transfer} />}
      {active.isError && <LoadError error={active.error} onRetry={() => void active.refetch()} />}
    </Card>
  );
}
