import { createRoute } from "@tanstack/react-router";

import { shellRoute } from "@/app/shell-route";
import { Downloads } from "@/screens/downloads/Downloads";

export const downloadsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "downloads",
  staticData: { titleKey: "nav.downloads" },
  component: Downloads,
});
