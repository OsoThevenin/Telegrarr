import { createRoute } from "@tanstack/react-router";

import { shellRoute } from "@/app/shell-route";
import { ConnectScreen } from "@/screens/connect/ConnectScreen";

export const connectRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "connect",
  staticData: { titleKey: "nav.connect" },
  component: ConnectScreen,
});
