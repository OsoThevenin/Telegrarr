import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/use-i18n";
import type { Download } from "@/lib/downloads";
import { isInTransfer, isRetryable } from "@/screens/downloads/download-list";
import { useDownloadActions } from "@/screens/downloads/use-download-actions";

type Props = {
  download: Download;
};

export function DownloadActions({ download }: Props) {
  const { t } = useI18n();
  const { isPending, stop, retry, remove } = useDownloadActions();

  return (
    <div className="flex items-center gap-1">
      {isInTransfer(download) && (
        <Button variant="outline" size="sm" disabled={isPending} onClick={() => stop(download.id)}>
          {t("dl.stop")}
        </Button>
      )}
      {isRetryable(download) && (
        <Button variant="outline" size="sm" disabled={isPending} onClick={() => retry(download.id)}>
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
