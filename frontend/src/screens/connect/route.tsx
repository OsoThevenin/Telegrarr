import { createRoute } from "@tanstack/react-router";

import { shellRoute } from "@/app/shell-route";
import { ScreenPlaceholder } from "@/components/ScreenPlaceholder";

export const connectRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "connect",
  staticData: { titleKey: "nav.connect" },
  component: ScreenPlaceholder,
});
