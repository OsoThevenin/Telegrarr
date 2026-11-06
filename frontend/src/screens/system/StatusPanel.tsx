import { useQuery } from "@tanstack/react-query";

import { LoadError } from "@/components/LoadError";
import { LoadingBlock } from "@/components/LoadingBlock";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/i18n/use-i18n";
import { formatBytes } from "@/lib/format";
import { useFormat } from "@/lib/use-format";
import { InfoGrid } from "@/screens/system/InfoGrid";
import { systemStatusQuery, type HealthCheck, type SystemStatus } from "@/screens/system/system-api";

// Literal keys, so tests/test_i18n.py can see them. A check added by a newer backend
// shows its id until the UI learns its name.
const HEALTH_NAME_KEYS: Record<string, string> = {
  telegram: "health.telegram.name",
  scanner: "health.scanner.name",
  disk: "health.disk.name",
  queue: "health.queue.name",
  database: "health.database.name",
};

function HealthRow({ check }: { check: HealthCheck }) {
  const { t, msg } = useI18n();
  const nameKey = HEALTH_NAME_KEYS[check.id];
  const isWarning = !check.ok && check.level === "warn";
  const verdict = check.ok ? t("sys.ok") : isWarning ? t("sys.warning") : t("sys.error");
  const variant = check.ok ? "secondary" : isWarning ? "outline" : "destructive";

  return (
    <li className="flex items-baseline gap-3 border-b py-2 text-sm last:border-b-0">
      <div className="flex min-w-0 flex-1 flex-col sm:flex-row sm:gap-3">
        <span className="font-medium sm:w-40 sm:shrink-0">{nameKey ? t(nameKey) : check.id}</span>
        <span className="min-w-0 break-words text-muted-foreground">{msg(check.message)}</span>
      </div>
      <Badge variant={variant} className="shrink-0">
        {verdict}
      </Badge>
    </li>
  );
}

function AboutGrid({ status }: { status: SystemStatus }) {
  const { t } = useI18n();
  const { duration } = useFormat();

  return (
    <InfoGrid
      rows={[
        [t("sys.version"), `v${status.version}`],
        ["Python", status.python],
        [t("sys.platform"), status.platform],
        [t("sys.uptime"), duration(status.uptime_seconds)],
        [t("nav.channels"), t("sys.channels_value", { enabled: status.channels_enabled, total: status.channels })],
        [t("sys.workers"), t("sys.workers_value", { workers: status.workers, concurrent: status.max_concurrent })],
        [t("health.database.name"), formatBytes(status.db_size)],
        [
          t("sys.disk"),
          t("sys.disk_value", { free: formatBytes(status.disk.free), total: formatBytes(status.disk.total) }),
        ],
        [t("sys.data_dir"), status.data_dir],
      ]}
    />
  );
}

export function StatusPanel() {
  const { t } = useI18n();
  const status = useQuery(systemStatusQuery);

  if (status.isPending) return <LoadingBlock />;
  if (status.isError) return <LoadError error={status.error} onRetry={() => void status.refetch()} />;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{t("sys.health")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul>
            {status.data.health.map((check) => (
              <HealthRow key={check.id} check={check} />
            ))}
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("sys.about")}</CardTitle>
        </CardHeader>
        <CardContent>
          <AboutGrid status={status.data} />
        </CardContent>
      </Card>
    </div>
  );
}
