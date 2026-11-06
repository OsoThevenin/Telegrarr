import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { LoadError } from "@/components/LoadError";
import { LoadingBlock } from "@/components/LoadingBlock";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useI18n } from "@/i18n/use-i18n";
import { api } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { useFormat } from "@/lib/use-format";
import { backupPath, backupsQuery, type Backup } from "@/screens/system/system-api";

function useRefreshBackups(): () => void {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: backupsQuery.queryKey });
}

function DeleteBackup({ name }: { name: string }) {
  const { t, errorText } = useI18n();
  const refreshBackups = useRefreshBackups();
  const remove = useMutation({
    mutationFn: () => api.delete(backupPath(name)),
    onSuccess: () => {
      toast.success(t("backup.deleted"));
      refreshBackups();
    },
    onError: (error) => toast.error(errorText(error)),
  });

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t("backup.delete")} title={t("backup.delete")}>
          <Trash2 aria-hidden="true" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("backup.delete_confirm")}</AlertDialogTitle>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => remove.mutate()}>
            {t("common.delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function BackupTable({ backups }: { backups: Backup[] }) {
  const { t } = useI18n();
  const { when } = useFormat();

  if (backups.length === 0) return <p className="text-muted-foreground">{t("backup.none")}</p>;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("backup.col.name")}</TableHead>
          <TableHead>{t("dl.col.size")}</TableHead>
          <TableHead>{t("backup.col.created")}</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {backups.map(({ name, size, created }) => (
          <TableRow key={name}>
            <TableCell className="whitespace-normal break-all">{name}</TableCell>
            <TableCell>{formatBytes(size)}</TableCell>
            <TableCell className="text-muted-foreground">{when(created)}</TableCell>
            <TableCell className="text-right">
              <Button asChild variant="ghost" size="sm">
                <a href={`${backupPath(name)}/download`}>{t("backup.download")}</a>
              </Button>
              <DeleteBackup name={name} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function BackupPanel() {
  const { t, errorText } = useI18n();
  const refreshBackups = useRefreshBackups();
  const backups = useQuery(backupsQuery);
  const create = useMutation({
    mutationFn: () => api.post("/api/system/backups"),
    onSuccess: () => {
      toast.success(t("backup.created"));
      refreshBackups();
    },
    onError: (error) => toast.error(errorText(error)),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={create.isPending} onClick={() => create.mutate()}>
          {t("backup.now")}
        </Button>
        <span className="text-sm text-muted-foreground">{t("backup.hint")}</span>
      </div>
      {backups.isPending && <LoadingBlock />}
      {backups.isError && <LoadError error={backups.error} onRetry={() => void backups.refetch()} />}
      {backups.isSuccess && <BackupTable backups={backups.data} />}
      <Card>
        <CardHeader>
          <CardTitle>{t("backup.restore")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t("backup.restore_body")}</p>
        </CardContent>
      </Card>
    </div>
  );
}
