import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { LoadError } from "@/components/LoadError";
import { LoadingBlock } from "@/components/LoadingBlock";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/use-i18n";
import { statusQuery, type Status } from "@/lib/status";
import { Capacity } from "@/screens/dashboard/Capacity";
import { dashboardState } from "@/screens/dashboard/dashboard-data";
import { DownloadsSummary } from "@/screens/dashboard/DownloadsSummary";
import { RecentlyGrabbed } from "@/screens/dashboard/RecentlyGrabbed";
import { StatStrip } from "@/screens/dashboard/StatStrip";
import { StatusLine } from "@/screens/dashboard/StatusLine";
import { UpNext } from "@/screens/dashboard/UpNext";

function FirstRun() {
  const { t } = useI18n();

  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border p-6">
      <p>{t("dash.first_run")}</p>
      <Button asChild>
        <Link to="/channels">{t("shell.add_channel")}</Link>
      </Button>
    </div>
  );
}

function Overview({ status }: { status: Status }) {
  return (
    <>
      <StatusLine status={status} />
      <DownloadsSummary status={status} />
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Capacity status={status} />
        <UpNext />
      </div>
      <RecentlyGrabbed />
    </>
  );
}

export function Dashboard() {
  const status = useQuery(statusQuery);

  if (status.isPending) return <LoadingBlock rows={6} />;
  if (status.isError) return <LoadError error={status.error} onRetry={() => void status.refetch()} />;

  const isFirstRun = status.data.stats.channels === 0;
  const hasNewsBeforeSetup = dashboardState(status.data).kind !== "ok";

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <StatStrip stats={status.data.stats} />
      {isFirstRun && hasNewsBeforeSetup && <StatusLine status={status.data} />}
      {isFirstRun ? <FirstRun /> : <Overview status={status.data} />}
    </div>
  );
}
