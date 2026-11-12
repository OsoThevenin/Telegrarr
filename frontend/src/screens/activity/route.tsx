import { createRoute, lazyRouteComponent } from "@tanstack/react-router";

import { shellRoute } from "@/app/shell-route";

export const activityRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "activity",
  staticData: { titleKey: "nav.activity" },
  component: lazyRouteComponent(() => import("@/screens/activity/Activity"), "Activity"),
});
