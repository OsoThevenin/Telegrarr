import { Pause } from "lucide-react";

import { useI18n } from "@/i18n/use-i18n";
import type { Download } from "@/lib/downloads";
import { cn } from "@/lib/utils";

type DownloadStatus = Download["status"];

/** The old UI's tinted capsules; paused is outlined, as it is held by hand rather than by the queue. */
const PILL_CLASS: Record<DownloadStatus, string> = {
  downloading: "bg-primary/15 text-primary",
  queued: "bg-warning/15 text-warning",
  completed: "bg-success/15 text-success",
  failed: "bg-destructive/15 text-destructive",
  cancelled: "bg-destructive/15 text-destructive",
  paused: "border-primary/40 text-primary",
};

export function StatusPill({ status }: { status: DownloadStatus }) {
  const { t } = useI18n();
  const labels: Record<DownloadStatus, string> = {
    queued: t("status.queued"),
    downloading: t("status.downloading"),
    paused: t("status.paused"),
    completed: t("status.completed"),
    failed: t("status.failed"),
    cancelled: t("status.cancelled"),
  };

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border border-transparent px-2.5 py-1 text-xs font-semibold whitespace-nowrap",
        PILL_CLASS[status],
      )}
    >
      {status === "downloading" && (
        <span aria-hidden="true" className="size-1.5 animate-pulse rounded-full bg-current motion-reduce:animate-none" />
      )}
      {status === "paused" && <Pause aria-hidden="true" className="size-3" />}
      {labels[status]}
    </span>
  );
}
