import { createRoute } from "@tanstack/react-router";

import { shellRoute } from "@/app/shell-route";
import { Downloads } from "@/screens/downloads/Downloads";
import { tabFromUrl } from "@/screens/downloads/download-list";

export const downloadsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "downloads",
  staticData: { titleKey: "nav.downloads" },
  validateSearch: (search: Record<string, unknown>): { tab?: string } => ({ tab: tabFromUrl(search.tab) }),
  component: Downloads,
});
