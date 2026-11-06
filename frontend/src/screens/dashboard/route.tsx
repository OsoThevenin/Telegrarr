import { createRoute, lazyRouteComponent } from "@tanstack/react-router";

import { shellRoute } from "@/app/shell-route";

export const dashboardRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/",
  staticData: { titleKey: "nav.dashboard", hasOwnStatusLine: true },
  component: lazyRouteComponent(() => import("@/screens/dashboard/Dashboard"), "Dashboard"),
});
