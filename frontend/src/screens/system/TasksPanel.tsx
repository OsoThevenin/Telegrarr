import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { LoadError } from "@/components/LoadError";
import { LoadingBlock } from "@/components/LoadingBlock";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useI18n } from "@/i18n/use-i18n";
import { api, type ServerMessage } from "@/lib/api";
import { useFormat } from "@/lib/use-format";
import { scanTasksQuery, type ScanTask } from "@/screens/system/system-api";

function TaskRow({ task }: { task: ScanTask }) {
  const { t, errorText } = useI18n();
  const { when, weekdays } = useFormat();
  const scan = useMutation({
    mutationFn: () => api.post(`/api/channels/${task.channel_id}/scan`),
    onSuccess: () => toast.success(t("scan.started")),
    onError: (error) => toast.error(errorText(error)),
  });

  return (
    <TableRow>
      <TableCell className="whitespace-normal">{t("sys.task_scan", { title: task.title })}</TableCell>
      <TableCell>{t("sys.every_minutes", { n: task.poll_minutes })}</TableCell>
      <TableCell className="text-muted-foreground">{weekdays(task.weekdays)}</TableCell>
      <TableCell className="text-muted-foreground">{when(task.last_run)}</TableCell>
      <TableCell>
        {task.enabled ? when(task.next_run) : <span className="text-muted-foreground">{t("sys.disabled")}</span>}
      </TableCell>
      <TableCell className="text-right">
        <Button variant="ghost" size="sm" disabled={scan.isPending} onClick={() => scan.mutate()}>
          {t("sys.run")}
        </Button>
      </TableCell>
    </TableRow>
  );
}

function TaskTable({ tasks }: { tasks: ScanTask[] }) {
  const { t } = useI18n();

  if (tasks.length === 0) return <p className="text-muted-foreground">{t("sys.no_tasks")}</p>;

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
        <Button disabled={scanAll.isPending} onClick={() => scanAll.mutate()}>
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
