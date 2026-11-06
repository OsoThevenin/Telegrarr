import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useI18n } from "@/i18n/use-i18n";
import { downloadName, downloadSource, type Download } from "@/lib/downloads";
import { cn } from "@/lib/utils";
import { DownloadActions } from "@/screens/downloads/DownloadActions";
import { DownloadNotes } from "@/screens/downloads/DownloadNotes";
import { isInTransfer } from "@/screens/downloads/download-list";
import { formatSize, percent, timeRemaining } from "@/screens/downloads/format";

type Props = {
  download: Download;
  isDense: boolean;
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

  return [
    downloadSource(download) || "—",
    file_size ? formatSize(file_size) : "—",
    ...(isInTransfer(download) ? transferDetails() : finishedDetails()),
  ]
    .filter(Boolean)
    .join(" · ");
}

export function DownloadRow({ download, isDense }: Props) {
  const { t } = useI18n();
  const name = downloadName(download);
  const details = useRowDetails(download);

  return (
    <li className={cn("flex flex-col gap-2 rounded-lg border bg-card px-3", isDense ? "py-1.5" : "py-3")}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1 basis-60">
          <p className="font-medium wrap-anywhere" title={download.save_path ?? undefined}>
            {name}
          </p>
          <p className="text-sm text-muted-foreground">{details}</p>
          <DownloadNotes download={download} />
        </div>
        <Badge variant="secondary">{t(`status.${download.status}`)}</Badge>
        <DownloadActions download={download} />
      </div>
      {isInTransfer(download) && <Progress value={percent(download)} aria-label={name} />}
    </li>
  );
}
