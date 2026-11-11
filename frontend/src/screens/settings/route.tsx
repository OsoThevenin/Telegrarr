import { createRoute, lazyRouteComponent } from "@tanstack/react-router";

import { shellRoute } from "@/app/shell-route";
import { settingsTabFromUrl, type SettingsTab } from "@/screens/settings/settings-tabs";

export const settingsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "settings",
  staticData: { titleKey: "nav.settings" },
  validateSearch: (search: Record<string, unknown>): { tab?: SettingsTab } => ({ tab: settingsTabFromUrl(search.tab) }),
  component: lazyRouteComponent(() => import("@/screens/settings/SettingsScreen"), "SettingsScreen"),
});
