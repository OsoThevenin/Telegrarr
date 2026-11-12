import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { useI18n } from "@/i18n/use-i18n";
import { downloadName, type Download } from "@/lib/downloads";
import { cn } from "@/lib/utils";
import { DownloadActions } from "@/screens/downloads/DownloadActions";
import { DownloadDetails } from "@/screens/downloads/DownloadDetails";
import { DownloadNotes } from "@/screens/downloads/DownloadNotes";
import { isPausable } from "@/screens/downloads/download-list";
import { percent } from "@/screens/downloads/format";
import { StatusPill } from "@/screens/downloads/StatusPill";
import type { DownloadSelection } from "@/screens/downloads/use-download-selection";

type Props = {
  download: Download;
  isDense: boolean;
  selection: DownloadSelection;
};

export function DownloadRow({ download, isDense, selection }: Props) {
  const { t } = useI18n();
  const name = downloadName(download);

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
          <DownloadDetails download={download} />
          <DownloadNotes download={download} />
        </div>
        <StatusPill status={download.status} />
        <DownloadActions download={download} />
      </div>
      {isPausable(download) && <Progress value={percent(download)} aria-label={name} />}
    </li>
  );
}
