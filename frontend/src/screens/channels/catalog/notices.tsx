import { Link } from "@tanstack/react-router";
import { LoaderCircleIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { LANGUAGES } from "@/i18n";
import { useI18n } from "@/i18n/use-i18n";
import type { DownloadFailure } from "@/screens/channels/catalog/queries";
import type { Channel } from "@/screens/channels/channel";

const MS_PER_SECOND = 1000;

export function RadarrIndicator({ isAvailable }: { isAvailable: boolean | null }) {
  const { t } = useI18n();
  const doneText = isAvailable ? t("cat.radarr_ok") : t("cat.radarr_down");

  return (
    <p aria-live="polite" className="flex items-center gap-1.5 text-muted-foreground">
      {isAvailable === null ? (
        <LoaderCircleIcon aria-hidden className="size-3 animate-spin" />
      ) : (
        <span aria-hidden className={`size-2 rounded-full ${isAvailable ? "bg-primary" : "bg-destructive"}`} />
      )}
      {isAvailable === null ? t("cat.radarr_checking") : doneText}
    </p>
  );
}

export function RadarrOffline() {
  const { t } = useI18n();

  return (
    <div role="status" className="flex flex-col gap-1 rounded-lg border p-3">
      <p className="font-medium">{t("cat.offline_title")}</p>
      <p className="text-muted-foreground">{t("cat.offline_body")}</p>
      <Link to="/connect" className="w-fit underline underline-offset-3">
        {t("cat.open_connect")}
      </Link>
    </div>
  );
}

type EmptyProps = {
  channel: Channel;
  isScanning: boolean;
  onScan: () => void;
};

export function EmptyCatalog({ channel, isScanning, onScan }: EmptyProps) {
  const { t, language } = useI18n();
  const locale = LANGUAGES.find(({ code }) => code === language)?.locale;
  const scannedAt = channel.last_scanned_at;
  const lastScan = scannedAt
    ? t("cat.last_scan", { when: new Date(scannedAt * MS_PER_SECOND).toLocaleString(locale) })
    : t("cat.never_scanned");

  return (
    <div className="flex flex-col items-start gap-2 py-4">
      <p className="font-medium">{t("cat.empty_title")}</p>
      <p className="text-muted-foreground">{t("cat.empty_body")}</p>
      <p className="text-muted-foreground">{lastScan}</p>
      <Button size="sm" variant="outline" disabled={isScanning} onClick={onScan}>
        {t("cat.scan_now")}
      </Button>
    </div>
  );
}

type NoResultsProps = {
  q: string;
  onClear: () => void;
};

export function NoResults({ q, onClear }: NoResultsProps) {
  const { t } = useI18n();

  return (
    <div className="flex flex-col items-start gap-2 py-4">
      <p className="font-medium">{t("cat.no_results", { q })}</p>
      <p className="text-muted-foreground">{t("cat.no_results_hint")}</p>
      <Button size="sm" variant="outline" onClick={onClear}>
        {t("cat.clear_search")}
      </Button>
    </div>
  );
}

type LoadFailedProps = {
  error: unknown;
  onRetry: () => void;
};

export function LoadFailed({ error, onRetry }: LoadFailedProps) {
  const { t, errorText } = useI18n();

  return (
    <div role="alert" className="flex flex-col items-start gap-2 rounded-lg border p-3">
      <p className="font-medium">{t("cat.load_failed")}</p>
      <p className="text-muted-foreground">{errorText(error)}</p>
      <Button size="sm" variant="outline" onClick={onRetry}>
        {t("cat.retry")}
      </Button>
    </div>
  );
}

type DownloadNoticeProps = {
  failure: DownloadFailure;
  onRetry: () => void;
  onDismiss: () => void;
};

/**
 * Inside the Sheet, not a toast: the Sheet is a modal dialog, so a toast's Retry could not be
 * reached by keyboard and a click on it would close the Sheet.
 */
export function DownloadNotice({ failure, onRetry, onDismiss }: DownloadNoticeProps) {
  const { t, errorText } = useI18n();
  const reason = errorText(failure.error).replace(/[.\s]+$/, "");

  return (
    <div role="alert" className="sticky bottom-4 flex items-start gap-3 rounded-lg border bg-popover p-3 shadow-md">
      <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
        <p className="font-medium">{t("cat.download_failed", { title: failure.film.title })}</p>
        <p className="text-muted-foreground">{t("cat.nothing_added", { reason })}</p>
        <Button size="sm" variant="outline" onClick={onRetry}>
          {t("cat.retry")}
        </Button>
      </div>
      <Button size="icon-sm" variant="ghost" aria-label={t("cat.dismiss")} onClick={onDismiss}>
        <XIcon />
      </Button>
    </div>
  );
}
