import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/use-i18n";
import type { Download } from "@/lib/downloads";
import { isInTransfer, isPausable, isPaused, isRetryable } from "@/screens/downloads/download-list";
import { useDownloadActions } from "@/screens/downloads/use-download-actions";

type Props = {
  download: Download;
};

export function DownloadActions({ download }: Props) {
  const { t } = useI18n();
  const { isPending, stop, retry, pause, resume, remove } = useDownloadActions();

  return (
    <div className="flex items-center gap-1">
      {isPausable(download) && (
        <Button
          variant="quiet"
          size="sm"
          title={t("dl.pause_hint")}
          disabled={isPending}
          onClick={() => pause(download.id)}
        >
          {t("dl.pause")}
        </Button>
      )}
      {isPaused(download) && (
        <Button
          variant="quiet"
          size="sm"
          title={t("dl.resume_hint")}
          disabled={isPending}
          onClick={() => resume(download.id)}
        >
          {t("dl.resume")}
        </Button>
      )}
      {isInTransfer(download) && (
        <Button variant="quiet" size="sm" disabled={isPending} onClick={() => stop(download.id)}>
          {t("dl.stop")}
        </Button>
      )}
      {isRetryable(download) && (
        <Button variant="quiet" size="sm" disabled={isPending} onClick={() => retry(download.id)}>
          {t("dl.retry")}
        </Button>
      )}
      {!isInTransfer(download) && (
        <Button
          variant="ghost"
          size="icon-sm"
          title={t("common.delete")}
          aria-label={t("dl.delete_record")}
          disabled={isPending}
          onClick={() => remove(download.id)}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}
