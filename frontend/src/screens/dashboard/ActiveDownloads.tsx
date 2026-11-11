import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CircleStop } from "lucide-react";

import { LoadError } from "@/components/LoadError";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/i18n/use-i18n";
import { downloadName, downloadsQuery, type Download } from "@/lib/downloads";
import type { Status } from "@/lib/status";
import { Meter } from "@/screens/dashboard/Meter";
import { StatusPill } from "@/screens/downloads/StatusPill";
import { useDownloadActions } from "@/screens/downloads/use-download-actions";
import { DownloadDetails } from "@/screens/downloads/DownloadDetails";
import { IN_PROGRESS_ID } from "@/screens/downloads/download-list";

/** Enough to see what is moving and what is next; the rest waits on Downloads. */
const MAX_ROWS = 5;

type ActiveStatus = "downloading" | "queued";

const isActive = (download: Download): download is Download & { status: ActiveStatus } =>
  download.status === "downloading" || download.status === "queued";

/** Transfers first, then the queue in the order it will run. */
const byQueueOrder = (a: Download, b: Download): number =>
  Number(b.status === "downloading") - Number(a.status === "downloading") || a.id - b.id;

const activeRows = (rows: Download[]) => rows.filter(isActive).sort(byQueueOrder);

function ActiveRow({ download }: { download: Download & { status: ActiveStatus } }) {
  const { t } = useI18n();
  const { isPending, stop } = useDownloadActions();
  const name = downloadName(download);

  return (
    <li className="flex min-w-0 flex-col gap-2.5 rounded-2xl border border-card-border bg-card px-4 py-3.5 shadow-card">
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1 truncate font-semibold" title={name}>
          {name}
        </span>
        <StatusPill status={download.status} />
        <Button
          variant="quiet"
          size="sm"
          disabled={isPending}
          onClick={() => stop(download.id)}
        >
          <CircleStop aria-hidden="true" />
          {t("dl.stop")}
        </Button>
      </div>
      <DownloadDetails download={download} className="truncate text-[13px]" />
      <Meter label={name} ratio={download.progress} />
    </li>
  );
}

/** What is downloading and what is next, each with a way to stop it, as on the old dashboard. */
export function ActiveDownloads({ status }: { status: Status }) {
  const { t } = useI18n();
  const rows = useQuery({ ...downloadsQuery, select: activeRows });
  const isIdle = status.stats.downloading === 0 && status.stats.queued === 0;
  const shown = rows.data?.slice(0, MAX_ROWS) ?? [];
  const hidden = (rows.data?.length ?? 0) - shown.length;

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{t("dash.active_now")}</CardTitle>
        {Boolean(status.speed) && (
          <CardAction className="text-sm font-medium text-primary tabular-nums">{status.speed?.toFixed(1)} MB/s</CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {isIdle ? (
          <Link to="/downloads" className="text-sm text-muted-foreground hover:text-foreground">
            {t("dash.idle")}
          </Link>
        ) : (
          <ul aria-label={t("dash.active_now")} className="flex min-w-0 flex-col gap-3">
            {shown.map((download) => (
              <ActiveRow key={download.id} download={download} />
            ))}
          </ul>
        )}
        {hidden > 0 && (
          <Link to="/downloads" hash={IN_PROGRESS_ID} className="self-start text-sm font-medium text-primary hover:underline">
            {t("dash.more_active", { n: hidden })}
          </Link>
        )}
        {rows.isError && <LoadError error={rows.error} onRetry={() => void rows.refetch()} />}
      </CardContent>
    </Card>
  );
}
