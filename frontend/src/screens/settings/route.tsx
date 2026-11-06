import { createRoute } from "@tanstack/react-router";

import { shellRoute } from "@/app/shell-route";
import { SettingsScreen } from "@/screens/settings/SettingsScreen";

export const settingsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "settings",
  staticData: { titleKey: "nav.settings" },
  component: SettingsScreen,
});
