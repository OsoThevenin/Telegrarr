import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/i18n/use-i18n";
import { BackupPanel } from "@/screens/system/BackupPanel";
import { StatusPanel } from "@/screens/system/StatusPanel";
import { TasksPanel } from "@/screens/system/TasksPanel";
import { UpdatesPanel } from "@/screens/system/UpdatesPanel";

export function System() {
  const { t } = useI18n();

  return (
    <Tabs defaultValue="status" className="gap-4">
      <TabsList>
        <TabsTrigger value="status">{t("sys.tab.status")}</TabsTrigger>
        <TabsTrigger value="tasks">{t("sys.tab.tasks")}</TabsTrigger>
        <TabsTrigger value="backup">{t("sys.tab.backup")}</TabsTrigger>
        <TabsTrigger value="updates">{t("sys.tab.updates")}</TabsTrigger>
      </TabsList>
      <TabsContent value="status">
        <StatusPanel />
      </TabsContent>
      <TabsContent value="tasks">
        <TasksPanel />
      </TabsContent>
      <TabsContent value="backup">
        <BackupPanel />
      </TabsContent>
      <TabsContent value="updates">
        <UpdatesPanel />
      </TabsContent>
    </Tabs>
  );
}
