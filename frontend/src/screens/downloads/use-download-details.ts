import { useI18n } from "@/i18n/use-i18n";
import { downloadSource, type Download } from "@/lib/downloads";
import { isInTransfer, isPaused } from "@/screens/downloads/download-list";
import { formatSize, fullDateTime, percent, relativeTime, timeRemaining } from "@/screens/downloads/format";

/** One phrase of a row's details, kept whole when the line wraps. */
export type DetailSegment = {
  text: string;
  /** More than the text says, for a tooltip: a relative date's full date and time. */
  title?: string;
};

/** Channel, size, then the live figures or, once finished, how long ago. */
export function useDownloadDetails(download: Download): DetailSegment[] {
  const { t, locale } = useI18n();
  const { status, speed_mbs, file_size, finished_at } = download;

  const transferDetails = (): (DetailSegment | null)[] => {
    const speed = status === "downloading" ? `${speed_mbs.toFixed(1)} MB/s` : status === "queued" ? t("dl.waiting") : null;
    const left = timeRemaining(download);
    const eta = left && (left.m ? t("common.eta_min", left) : t("common.eta_sec", left));
    return [speed ? { text: speed } : null, eta ? { text: eta } : null, { text: `${percent(download)}%` }];
  };
  const finishedDetails = (): (DetailSegment | null)[] => [
    finished_at ? { text: relativeTime(finished_at, locale), title: fullDateTime(finished_at, locale) } : null,
  ];

  const stateDetails = () => {
    // Nothing of a paused row's run survives: its note says what comes next.
    if (isPaused(download)) return [];
    return isInTransfer(download) ? transferDetails() : finishedDetails();
  };

  return [
    { text: downloadSource(download) || "—" },
    { text: file_size ? formatSize(file_size) : "—" },
    ...stateDetails(),
  ].filter((segment): segment is DetailSegment => segment !== null);
}
