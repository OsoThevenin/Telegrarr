import { createRoute } from "@tanstack/react-router";

import { shellRoute } from "@/app/shell-route";
import { ScreenPlaceholder } from "@/components/ScreenPlaceholder";

export const settingsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "settings",
  staticData: { titleKey: "nav.settings" },
  component: ScreenPlaceholder,
});
