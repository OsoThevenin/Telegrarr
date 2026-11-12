import { getRouteApi } from "@tanstack/react-router";

import { StatusLine } from "@/components/StatusLine";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/i18n/use-i18n";
import { useSettings } from "@/lib/settings";
import { AccountTab } from "@/screens/settings/AccountTab";
import { DownloadsTab } from "@/screens/settings/DownloadsTab";
import { IntegrationsTab } from "@/screens/settings/IntegrationsTab";
import { DEFAULT_SETTINGS_TAB, settingsTabFromUrl } from "@/screens/settings/settings-tabs";
import { SMALL_BUTTON } from "@/lib/touch";

const route = getRouteApi("/settings");

// Every tab stays mounted, so a half-typed form survives a look at another tab.
const PANEL = "flex flex-col gap-4 data-[state=inactive]:hidden";
// The registry's dimmer default falls short of 4.5:1 on the muted tab bar.
const TAB = "text-foreground/75";

export function SettingsScreen() {
  const { t, errorText } = useI18n();
  const query = useSettings();
  const { tab: openTab = DEFAULT_SETTINGS_TAB } = route.useSearch();
  const navigate = route.useNavigate();

  // A tab switch replaces the entry, so Back leaves Settings instead of walking the tabs.
  function handleTabChange(value: string) {
    void navigate({ search: { tab: settingsTabFromUrl(value) }, replace: true });
  }

  if (query.data) {
    const { settings, paths, user } = query.data;
    return (
      <Tabs value={openTab} onValueChange={handleTabChange} className="mx-auto w-full max-w-3xl">
        <TabsList>
          <TabsTrigger value="account" className={TAB}>{t("set.account")}</TabsTrigger>
          <TabsTrigger value="downloads" className={TAB}>{t("nav.downloads")}</TabsTrigger>
          <TabsTrigger value="integrations" className={TAB}>{t("set.integrations")}</TabsTrigger>
        </TabsList>
        <TabsContent value="account" forceMount className={PANEL}>
          <AccountTab username={user} />
        </TabsContent>
        <TabsContent value="downloads" forceMount className={PANEL}>
          <DownloadsTab settings={settings} paths={paths} />
        </TabsContent>
        <TabsContent value="integrations" forceMount className={PANEL}>
          <IntegrationsTab settings={settings} />
        </TabsContent>
      </Tabs>
    );
  }

  if (query.isError) {
    return (
      <div className="flex flex-col items-start gap-2">
        <StatusLine tone="error">{errorText(query.error)}</StatusLine>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={SMALL_BUTTON}
          onClick={() => void query.refetch()}
        >
          {t("common.retry")}
        </Button>
      </div>
    );
  }

  return <StatusLine tone="neutral">{t("common.loading")}</StatusLine>;
}
