import { Link } from "@tanstack/react-router";

import { useI18n } from "@/i18n/use-i18n";
import type { Stats } from "@/lib/status";
import { cn } from "@/lib/utils";
import { COMPLETED_TAB, FAILED_TAB, IN_PROGRESS_ID, type DownloadTab } from "@/screens/downloads/download-list";

/** The old UI's colour per count: blue moving, amber waiting, green done, red failed. */
const TONE_CLASS = {
  plain: "",
  active: "text-primary",
  waiting: "text-warning",
  done: "text-success",
  alert: "text-destructive",
} as const;

type StatProps = {
  /** Where on Downloads it leads: a history tab, or En curs; with neither, it opens the Channels. */
  tab?: DownloadTab;
  isInProgress?: boolean;
  value: number;
  label: string;
  tone?: keyof typeof TONE_CLASS;
};

function linkOf({ tab, isInProgress }: Pick<StatProps, "tab" | "isInProgress">) {
  if (isInProgress) return { to: "/downloads", hash: IN_PROGRESS_ID } as const;
  return tab ? ({ to: "/downloads", search: { tab: tab.id } } as const) : ({ to: "/channels" } as const);
}

function Stat({ tab, isInProgress, value, label, tone = "plain" }: StatProps) {
  return (
    <Link
      {...linkOf({ tab, isInProgress })}
      className="flex min-w-0 flex-col gap-0.5 rounded-2xl border border-card-border bg-card px-4 py-3.5 shadow-card transition-[translate,box-shadow] hover:-translate-y-0.5 hover:shadow-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:hover:translate-y-0"
    >
      <span className={cn("text-2xl font-semibold tabular-nums", TONE_CLASS[tone])}>{value}</span>
      <span className="truncate text-sm font-medium text-muted-foreground">{label}</span>
    </Link>
  );
}

export function StatStrip({ stats }: { stats: Stats }) {
  const { t } = useI18n();

  return (
    <nav aria-label={t("nav.dashboard")} className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <Stat value={stats.channels} label={t("nav.channels")} />
      <Stat isInProgress value={stats.downloading} label={t("dash.stat.downloading")} tone="active" />
      <Stat isInProgress value={stats.queued} label={t("dash.stat.queued")} tone="waiting" />
      <Stat tab={COMPLETED_TAB} value={stats.completed} label={t("dash.stat.completed")} tone="done" />
      <Stat
        tab={FAILED_TAB}
        value={stats.failed}
        label={t("dash.stat.failed")}
        tone={stats.failed > 0 ? "alert" : "plain"}
      />
    </nav>
  );
}
