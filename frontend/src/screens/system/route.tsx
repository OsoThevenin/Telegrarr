import { createRoute } from "@tanstack/react-router";

import { shellRoute } from "@/app/shell-route";
import { System } from "@/screens/system/System";

export const systemRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "system",
  staticData: { titleKey: "nav.system" },
  component: System,
});
