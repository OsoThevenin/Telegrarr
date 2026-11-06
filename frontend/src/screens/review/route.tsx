import { createRoute } from "@tanstack/react-router";

import { shellRoute } from "@/app/shell-route";
import { ScreenPlaceholder } from "@/components/ScreenPlaceholder";

export const reviewRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "review",
  staticData: { titleKey: "nav.review" },
  component: ScreenPlaceholder,
});
