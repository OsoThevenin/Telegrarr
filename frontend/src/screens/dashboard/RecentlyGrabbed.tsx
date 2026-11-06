import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { LoadError } from "@/components/LoadError";
import { LoadingBlock } from "@/components/LoadingBlock";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/i18n/use-i18n";
import { downloadName, downloadSource, type Download } from "@/lib/downloads";
import { formatBytes } from "@/lib/format";
import { useFormat } from "@/lib/use-format";
import { recentDownloadsQuery } from "@/screens/dashboard/dashboard-data";

const MAX_ROWS = 5;

function latestFinished(downloads: readonly Download[]): Download[] {
  return downloads.toSorted((a, b) => (b.finished_at ?? 0) - (a.finished_at ?? 0)).slice(0, MAX_ROWS);
}

function RecentRow({ download }: { download: Download }) {
  const { when } = useFormat();
  const name = downloadName(download);
  const facts = [
    download.file_size ? formatBytes(download.file_size) : null,
    download.finished_at ? when(download.finished_at) : null,
  ].filter(Boolean);

  return (
    <div data-testid="recent-row" className="flex items-baseline justify-between gap-3 text-sm">
      <div className="flex min-w-0 flex-col">
        <span className="truncate" title={name}>
          {name}
        </span>
        <span className="truncate text-muted-foreground">{downloadSource(download)}</span>
      </div>
      <span className="shrink-0 text-muted-foreground tabular-nums">{facts.join(" · ")}</span>
    </div>
  );
}

export function RecentlyGrabbed() {
  const { t } = useI18n();
  const recent = useQuery(recentDownloadsQuery);
  const rows = latestFinished(recent.data ?? []);

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{t("dash.recent")}</CardTitle>
        <CardAction>
          <Link to="/downloads" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
            {t("nav.downloads")}
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {recent.isPending && <LoadingBlock rows={MAX_ROWS} />}
        {recent.isError && <LoadError error={recent.error} onRetry={() => void recent.refetch()} />}
        {recent.isSuccess && rows.length === 0 && (
          <p className="text-sm text-muted-foreground">{t("dash.no_downloads")}</p>
        )}
        {rows.map((download) => (
          <RecentRow key={download.id} download={download} />
        ))}
      </CardContent>
    </Card>
  );
}
