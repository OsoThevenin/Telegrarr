import { Link } from "@tanstack/react-router";

import { useI18n } from "@/i18n/use-i18n";
import type { Stats } from "@/lib/status";
import { cn } from "@/lib/utils";
import { ACTIVE_TAB, COMPLETED_TAB, FAILED_TAB, type DownloadTab } from "@/screens/downloads/download-list";

type StatProps = {
  /** The Downloads tab it opens; without one, it opens the Channels. */
  tab?: DownloadTab;
  value: number;
  label: string;
  isAlert?: boolean;
};

function Stat({ tab, value, label, isAlert = false }: StatProps) {
  return (
    <Link
      {...(tab ? { to: "/downloads", search: { tab: tab.id } } : { to: "/channels" })}
      className="flex min-w-0 flex-1 basis-[30%] flex-col gap-0.5 bg-card p-3 transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:basis-0 sm:p-4"
    >
      <span className={cn("text-2xl font-semibold tabular-nums", isAlert && "text-destructive")}>{value}</span>
      <span className="truncate text-sm text-muted-foreground">{label}</span>
    </Link>
  );
}

/** One strip, not five cards: the counts read as a single line of facts. */
export function StatStrip({ stats }: { stats: Stats }) {
  const { t } = useI18n();

  return (
    <nav aria-label={t("nav.dashboard")} className="flex flex-wrap gap-px overflow-hidden rounded-lg border bg-border">
      <Stat value={stats.channels} label={t("nav.channels")} />
      <Stat tab={ACTIVE_TAB} value={stats.downloading} label={t("dash.stat.downloading")} />
      <Stat tab={ACTIVE_TAB} value={stats.queued} label={t("dash.stat.queued")} />
      <Stat tab={COMPLETED_TAB} value={stats.completed} label={t("dash.stat.completed")} />
      <Stat tab={FAILED_TAB} value={stats.failed} label={t("dash.stat.failed")} isAlert={stats.failed > 0} />
    </nav>
  );
}
