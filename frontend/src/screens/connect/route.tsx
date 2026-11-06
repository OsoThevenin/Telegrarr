import { createRoute, lazyRouteComponent } from "@tanstack/react-router";

import { shellRoute } from "@/app/shell-route";

export const connectRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "connect",
  staticData: { titleKey: "nav.connect" },
  component: lazyRouteComponent(() => import("@/screens/connect/ConnectScreen"), "ConnectScreen"),
});
