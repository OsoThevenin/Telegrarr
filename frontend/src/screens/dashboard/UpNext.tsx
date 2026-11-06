import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { LoadError } from "@/components/LoadError";
import { LoadingBlock } from "@/components/LoadingBlock";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/i18n/use-i18n";
import { useFormat } from "@/lib/use-format";
import { scanTasksQuery, type ScanTask } from "@/screens/system/system-api";

const MAX_ROWS = 3;

function soonest(tasks: readonly ScanTask[]): ScanTask[] {
  return tasks
    .filter((task) => task.enabled && task.next_run)
    .toSorted((a, b) => (a.next_run ?? 0) - (b.next_run ?? 0))
    .slice(0, MAX_ROWS);
}

export function UpNext() {
  const { t } = useI18n();
  const { when } = useFormat();
  const tasks = useQuery(scanTasksQuery);
  const rows = soonest(tasks.data ?? []);

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{t("dash.up_next")}</CardTitle>
        <CardAction>
          <Link to="/system" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
            {t("nav.system")}
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {tasks.isPending && <LoadingBlock rows={MAX_ROWS} />}
        {tasks.isError && <LoadError error={tasks.error} onRetry={() => void tasks.refetch()} />}
        {tasks.isSuccess && rows.length === 0 && <p className="text-muted-foreground">{t("dash.none_scheduled")}</p>}
        {rows.map((task) => (
          <div key={task.channel_id + task.title} data-testid="up-next-row" className="flex justify-between gap-3">
            <span className="min-w-0 truncate" title={task.title}>
              {task.title}
            </span>
            <span className="shrink-0 text-muted-foreground tabular-nums">{when(task.next_run)}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
