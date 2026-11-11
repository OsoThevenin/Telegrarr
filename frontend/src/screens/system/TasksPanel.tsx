import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ScanSearch } from "lucide-react";
import { toast } from "sonner";

import { LoadError } from "@/components/LoadError";
import { LoadingBlock } from "@/components/LoadingBlock";
import { ToneBadge } from "@/components/ToneBadge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useI18n } from "@/i18n/use-i18n";
import { api, type ServerMessage } from "@/lib/api";
import { BUTTON, SMALL_BUTTON } from "@/lib/touch";
import { useFormat } from "@/lib/use-format";
import { PHONE_QUERY, useMediaQuery } from "@/lib/use-media-query";
import { scanTasksQuery, type ScanTask } from "@/screens/system/system-api";

function useScanTask(task: ScanTask) {
  const { t, errorText } = useI18n();
  return useMutation({
    mutationFn: () => api.post(`/api/channels/${task.channel_id}/scan`),
    onSuccess: () => toast.success(t("scan.started")),
    onError: (error) => toast.error(errorText(error)),
  });
}

function RunButton({ task }: { task: ScanTask }) {
  const { t } = useI18n();
  const scan = useScanTask(task);
  return (
    <Button variant="ghost" size="sm" className={SMALL_BUTTON} disabled={scan.isPending} onClick={() => scan.mutate()}>
      {t("sys.run")}
    </Button>
  );
}

function NextRun({ task }: { task: ScanTask }) {
  const { t } = useI18n();
  const { when } = useFormat();
  return task.enabled ? when(task.next_run) : <ToneBadge tone="neutral">{t("sys.disabled")}</ToneBadge>;
}

function TaskRow({ task }: { task: ScanTask }) {
  const { t } = useI18n();
  const { when, weekdays } = useFormat();

  return (
    <TableRow>
      <TableCell className="whitespace-normal">{t("sys.task_scan", { title: task.title })}</TableCell>
      <TableCell>{t("sys.every_minutes", { n: task.poll_minutes })}</TableCell>
      <TableCell className="text-muted-foreground">{weekdays(task.weekdays)}</TableCell>
      <TableCell className="text-muted-foreground">{when(task.last_run)}</TableCell>
      <TableCell>
        <NextRun task={task} />
      </TableCell>
      <TableCell className="text-right">
        <RunButton task={task} />
      </TableCell>
    </TableRow>
  );
}

/** A phone's take on a row: the same facts stacked, so nothing scrolls sideways. */
function TaskCard({ task }: { task: ScanTask }) {
  const { t } = useI18n();
  const { when, weekdays } = useFormat();

  return (
    <li className="flex flex-col gap-2 border-b py-3 text-sm last:border-b-0">
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1 font-medium break-words">{t("sys.task_scan", { title: task.title })}</span>
        <RunButton task={task} />
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
        <dt className="text-muted-foreground">{t("sys.interval")}</dt>
        <dd>{t("sys.every_minutes", { n: task.poll_minutes })}</dd>
        <dt className="text-muted-foreground">{t("sys.days")}</dt>
        <dd>{weekdays(task.weekdays)}</dd>
        <dt className="text-muted-foreground">{t("sys.last_run")}</dt>
        <dd>{when(task.last_run)}</dd>
        <dt className="text-muted-foreground">{t("sys.next_run")}</dt>
        <dd>
          <NextRun task={task} />
        </dd>
      </dl>
    </li>
  );
}

function TaskTable({ tasks }: { tasks: ScanTask[] }) {
  const { t } = useI18n();
  const isPhone = useMediaQuery(PHONE_QUERY);

  if (tasks.length === 0) return <p className="text-muted-foreground">{t("sys.no_tasks")}</p>;

  if (isPhone) {
    return (
      <ul>
        {tasks.map((task) => (
          <TaskCard key={task.channel_id} task={task} />
        ))}
      </ul>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("sys.task")}</TableHead>
          <TableHead>{t("sys.interval")}</TableHead>
          <TableHead>{t("sys.days")}</TableHead>
          <TableHead>{t("sys.last_run")}</TableHead>
          <TableHead>{t("sys.next_run")}</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {tasks.map((task) => (
          <TaskRow key={task.channel_id} task={task} />
        ))}
      </TableBody>
    </Table>
  );
}

export function TasksPanel() {
  const { t, msg, errorText } = useI18n();
  const queryClient = useQueryClient();
  const tasks = useQuery(scanTasksQuery);
  const scanAll = useMutation({
    mutationFn: () => api.post<{ message?: ServerMessage | null }>("/api/system/tasks/scan_all"),
    onSuccess: ({ message }) => {
      toast.success(msg(message) || t("sys.scanning"));
      void queryClient.invalidateQueries({ queryKey: scanTasksQuery.queryKey });
    },
    onError: (error) => toast.error(errorText(error)),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button className={BUTTON} disabled={scanAll.isPending} onClick={() => scanAll.mutate()}>
          <ScanSearch data-icon="inline-start" aria-hidden="true" />
          {t("sys.scan_all_now")}
        </Button>
        <span className="text-sm text-muted-foreground">{t("sys.tasks_hint")}</span>
      </div>
      {tasks.isPending && <LoadingBlock />}
      {tasks.isError && <LoadError error={tasks.error} onRetry={() => void tasks.refetch()} />}
      {tasks.isSuccess && <TaskTable tasks={tasks.data} />}
    </div>
  );
}
