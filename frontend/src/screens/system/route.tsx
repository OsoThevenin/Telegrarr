import { createRoute } from "@tanstack/react-router";

import { shellRoute } from "@/app/shell-route";
import { ScreenPlaceholder } from "@/components/ScreenPlaceholder";

export const systemRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "system",
  staticData: { titleKey: "nav.system" },
  component: ScreenPlaceholder,
});
