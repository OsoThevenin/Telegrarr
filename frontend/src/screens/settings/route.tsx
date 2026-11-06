import { createRoute, lazyRouteComponent } from "@tanstack/react-router";

import { shellRoute } from "@/app/shell-route";

export const settingsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "settings",
  staticData: { titleKey: "nav.settings" },
  component: lazyRouteComponent(() => import("@/screens/settings/SettingsScreen"), "SettingsScreen"),
});
