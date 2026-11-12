import { createRoute, lazyRouteComponent } from "@tanstack/react-router";

import { shellRoute } from "@/app/shell-route";
import { tabFromUrl } from "@/screens/downloads/download-list";

export const downloadsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "downloads",
  staticData: { titleKey: "nav.downloads" },
  validateSearch: (search: Record<string, unknown>): { tab?: string } => ({ tab: tabFromUrl(search.tab) }),
  component: lazyRouteComponent(() => import("@/screens/downloads/Downloads"), "Downloads"),
});
