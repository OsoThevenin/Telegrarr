import { createRoute, lazyRouteComponent } from "@tanstack/react-router";

import { shellRoute } from "@/app/shell-route";

export const systemRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "system",
  staticData: { titleKey: "nav.system" },
  component: lazyRouteComponent(() => import("@/screens/system/System"), "System"),
});
