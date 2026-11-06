import { createRoute } from "@tanstack/react-router";

import { shellRoute } from "@/app/shell-route";
import { ScreenPlaceholder } from "@/components/ScreenPlaceholder";

export const dashboardRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/",
  staticData: { titleKey: "nav.dashboard" },
  component: ScreenPlaceholder,
});
