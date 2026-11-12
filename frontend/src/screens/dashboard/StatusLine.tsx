import { Link } from "@tanstack/react-router";
import { CircleAlert, CircleCheck } from "lucide-react";
import type { ReactNode } from "react";

import { useQueuePause } from "@/app/use-queue-pause";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/use-i18n";
import { formatBytes } from "@/lib/format";
import type { Status } from "@/lib/status";
import { useFormat } from "@/lib/use-format";
import { cn } from "@/lib/utils";
import { dashboardState, type DashboardState } from "@/screens/dashboard/dashboard-data";

function ResumeQueue() {
  const { t } = useI18n();
  const { isPending, toggle } = useQueuePause();

  return (
    <Button variant="outline" size="sm" disabled={isPending} onClick={toggle}>
      {t("shell.resume")}
    </Button>
  );
}

function useStateMessage(state: DashboardState, status: Status): { text: string; action?: ReactNode } {
  const { t, tn } = useI18n();
  const { time } = useFormat();

  switch (state.kind) {
    case "signed_out":
      return {
        text: t("health.telegram.off"),
        action: (
          <Button asChild variant="outline" size="sm">
            <Link to="/settings" search={{ tab: "integrations" }}>{t("banner.connect_telegram")}</Link>
          </Button>
        ),
      };
    case "budget":
      return { text: t("budget.banner", { limit: status.budget.limit_gb, at: time(status.budget.resets_at) }) };
    case "paused":
      return { text: t("dash.state.paused"), action: <ResumeQueue /> };
    case "disk_low":
      return { text: t("dash.state.disk_low", { free: formatBytes(status.disk.free) }) };
    case "failed":
      return {
        text: tn("dash.state.failed", status.stats.failed),
        action: (
          <Button asChild variant="outline" size="sm">
            <Link to="/downloads">{t("nav.downloads")}</Link>
          </Button>
        ),
      };
    case "ok":
      return { text: t("dash.state.ok") };
  }
}

/** The verdict: says whether anything needs the user, in words, with the one action that helps. */
export function StatusLine({ status }: { status: Status }) {
  const state = dashboardState(status);
  const { text, action } = useStateMessage(state, status);
  const isOk = state.kind === "ok";
  const Icon = isOk ? CircleCheck : CircleAlert;

  return (
    <div
      role="status"
      data-testid="status-line"
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 text-sm",
        isOk ? "px-1 text-muted-foreground" : "rounded-lg bg-muted p-3 font-medium",
      )}
    >
      <Icon aria-hidden="true" className={cn("size-4 shrink-0", !isOk && "text-destructive")} />
      <span className="min-w-0 flex-1 basis-48">{text}</span>
      {action}
    </div>
  );
}
