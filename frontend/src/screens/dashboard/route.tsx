import { createRoute } from "@tanstack/react-router";

import { shellRoute } from "@/app/shell-route";
import { Dashboard } from "@/screens/dashboard/Dashboard";

export const dashboardRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/",
  staticData: { titleKey: "nav.dashboard" },
  component: Dashboard,
});
