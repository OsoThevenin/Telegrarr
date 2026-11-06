import { createRoute } from "@tanstack/react-router";

import { shellRoute } from "@/app/shell-route";
import { ScreenPlaceholder } from "@/components/ScreenPlaceholder";

export const channelsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "channels",
  staticData: { titleKey: "nav.channels" },
  component: ScreenPlaceholder,
});
