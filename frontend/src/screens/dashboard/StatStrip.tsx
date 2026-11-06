import { Link, type LinkProps } from "@tanstack/react-router";

import { useI18n } from "@/i18n/use-i18n";
import type { Stats } from "@/lib/status";
import { cn } from "@/lib/utils";

type StatProps = {
  to: NonNullable<LinkProps["to"]>;
  value: number;
  label: string;
  isAlert?: boolean;
};

function Stat({ to, value, label, isAlert = false }: StatProps) {
  return (
    <Link
      to={to}
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
      <Stat to="/channels" value={stats.channels} label={t("nav.channels")} />
      <Stat to="/downloads" value={stats.downloading} label={t("dash.stat.downloading")} />
      <Stat to="/downloads" value={stats.queued} label={t("dash.stat.queued")} />
      <Stat to="/downloads" value={stats.completed} label={t("dash.stat.completed")} />
      <Stat to="/downloads" value={stats.failed} label={t("dash.stat.failed")} isAlert={stats.failed > 0} />
    </nav>
  );
}
