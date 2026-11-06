import { createRoute } from "@tanstack/react-router";

import { shellRoute } from "@/app/shell-route";
import { ScreenPlaceholder } from "@/components/ScreenPlaceholder";

export const downloadsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "downloads",
  staticData: { titleKey: "nav.downloads" },
  component: ScreenPlaceholder,
});
