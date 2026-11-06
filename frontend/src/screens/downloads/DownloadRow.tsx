import { Pause } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { useI18n } from "@/i18n/use-i18n";
import { downloadName, downloadSource, type Download } from "@/lib/downloads";
import { cn } from "@/lib/utils";
import { DownloadActions } from "@/screens/downloads/DownloadActions";
import { DownloadNotes } from "@/screens/downloads/DownloadNotes";
import { isInTransfer, isPausable, isPaused } from "@/screens/downloads/download-list";
import { formatSize, percent, timeRemaining } from "@/screens/downloads/format";
import type { DownloadSelection } from "@/screens/downloads/use-download-selection";

type Props = {
  download: Download;
  isDense: boolean;
  selection: DownloadSelection;
};

/** Channel, size, then the live figures or, once finished, the date. */
function useRowDetails(download: Download): string {
  const { t, locale } = useI18n();
  const { status, speed_mbs, file_size, finished_at } = download;

  const transferDetails = () => {
    const speed = status === "downloading" ? `${speed_mbs.toFixed(1)} MB/s` : status === "queued" && t("dl.waiting");
    const left = timeRemaining(download);
    const eta = left && (left.m ? t("common.eta_min", left) : t("common.eta_sec", left));
    return [speed, eta, `${percent(download)}%`];
  };
  const finishedDetails = () => [finished_at ? new Date(finished_at * 1000).toLocaleDateString(locale) : null];

  const stateDetails = () => {
    // Nothing of a paused row's run survives: its note says what comes next.
    if (isPaused(download)) return [];
    return isInTransfer(download) ? transferDetails() : finishedDetails();
  };

  return [downloadSource(download) || "—", file_size ? formatSize(file_size) : "—", ...stateDetails()]
    .filter(Boolean)
    .join(" · ");
}

/** Held by hand, so it reads apart from the states the queue moves through by itself. */
function StatusBadge({ download }: Pick<Props, "download">) {
  const { t } = useI18n();
  const label = t(`status.${download.status}`);

  if (!isPaused(download)) return <Badge variant="secondary">{label}</Badge>;
  return (
    <Badge variant="outline">
      <Pause aria-hidden="true" />
      {label}
    </Badge>
  );
}

export function DownloadRow({ download, isDense, selection }: Props) {
  const { t } = useI18n();
  const name = downloadName(download);
  const details = useRowDetails(download);

  const isSelected = selection.isSelected(download.id);

  return (
    <li
      className={cn(
        "flex flex-col gap-2 rounded-lg border bg-card px-3",
        isDense ? "py-1.5" : "py-3",
        isSelected && "border-primary/50",
      )}
    >
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <Checkbox
          aria-label={t("dl.select_download", { name })}
          checked={isSelected}
          onCheckedChange={(checked) => selection.toggle(download.id, checked === true)}
          className="mt-1 after:-inset-3.5"
        />
        <div className="min-w-0 flex-1 basis-60">
          <p className="font-medium wrap-anywhere" title={download.save_path ?? undefined}>
            {name}
          </p>
          <p className="text-sm text-muted-foreground">{details}</p>
          <DownloadNotes download={download} />
        </div>
        <StatusBadge download={download} />
        <DownloadActions download={download} />
      </div>
      {isPausable(download) && <Progress value={percent(download)} aria-label={name} />}
    </li>
  );
}
