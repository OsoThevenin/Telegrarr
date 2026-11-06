import type { ReactNode } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/i18n/use-i18n";
import { formatBytes } from "@/lib/format";
import type { Status } from "@/lib/status";
import { useFormat } from "@/lib/use-format";
import { budgetRatio, toneOf, usedRatio, type MeterTone } from "@/screens/dashboard/dashboard-data";
import { Meter } from "@/screens/dashboard/Meter";

type GaugeProps = {
  label: string;
  ratio: number;
  tone: MeterTone;
  children: ReactNode;
};

function Gauge({ label, ratio, tone, children }: GaugeProps) {
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <div className="flex items-baseline justify-between gap-3">
        <span>{label}</span>
        <span className="text-muted-foreground tabular-nums">{Math.round(ratio * 100)}%</span>
      </div>
      <Meter label={label} ratio={ratio} tone={tone} />
      <div className="flex flex-wrap justify-between gap-x-3 text-muted-foreground tabular-nums">{children}</div>
    </div>
  );
}

export function Capacity({ status }: { status: Status }) {
  const { t } = useI18n();
  const { time } = useFormat();
  const { budget, disk, stats } = status;
  const budgetUsed = budgetRatio(budget);
  const diskUsed = usedRatio(disk.used, disk.total);

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{t("dash.capacity")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {budget.limit_gb > 0 && (
          <Gauge label={t("dash.budget")} ratio={budgetUsed} tone={budget.exhausted ? "critical" : toneOf(budgetUsed)}>
            <span>{t("dash.budget_used", { used: formatBytes(budget.used_bytes), limit: budget.limit_gb })}</span>
            <span>{t("dash.budget_resets", { at: time(budget.resets_at) })}</span>
          </Gauge>
        )}
        {disk.total > 0 && (
          <Gauge label={t("sys.disk")} ratio={diskUsed} tone={toneOf(diskUsed)}>
            <span>{t("dash.bytes_used", { size: formatBytes(disk.used) })}</span>
            <span>{t("dash.bytes_free", { size: formatBytes(disk.free) })}</span>
          </Gauge>
        )}
        <div className="flex justify-between gap-3 text-sm">
          <span>{t("dash.stat.library")}</span>
          <span className="text-muted-foreground tabular-nums">{formatBytes(stats.total_size)}</span>
        </div>
      </CardContent>
    </Card>
  );
}
