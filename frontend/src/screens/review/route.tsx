import { createRoute, lazyRouteComponent } from "@tanstack/react-router";

import { shellRoute } from "@/app/shell-route";

export const reviewRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "review",
  staticData: { titleKey: "nav.review" },
  component: lazyRouteComponent(() => import("./Review"), "Review"),
});
