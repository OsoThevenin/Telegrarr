import { createRoute } from "@tanstack/react-router";

import { shellRoute } from "@/app/shell-route";
import { ScreenPlaceholder } from "@/components/ScreenPlaceholder";

export const activityRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "activity",
  staticData: { titleKey: "nav.activity" },
  component: ScreenPlaceholder,
});
