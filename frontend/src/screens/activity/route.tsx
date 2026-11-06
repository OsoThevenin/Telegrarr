import { createRoute } from "@tanstack/react-router";

import { shellRoute } from "@/app/shell-route";
import { Activity } from "@/screens/activity/Activity";

export const activityRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "activity",
  staticData: { titleKey: "nav.activity" },
  component: Activity,
});
