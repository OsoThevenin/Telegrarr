import { createRouter, type RouterHistory } from "@tanstack/react-router";

import { shellRoute } from "@/app/shell-route";
import { activityRoute } from "@/screens/activity/route";
import { channelsRoute } from "@/screens/channels/route";
import { connectRoute } from "@/screens/connect/route";
import { dashboardRoute } from "@/screens/dashboard/route";
import { downloadsRoute } from "@/screens/downloads/route";
import { reviewRoute } from "@/screens/review/route";
import { settingsRoute } from "@/screens/settings/route";
import { systemRoute } from "@/screens/system/route";

const routeTree = shellRoute.addChildren([
  dashboardRoute,
  channelsRoute,
  downloadsRoute,
  activityRoute,
  reviewRoute,
  connectRoute,
  systemRoute,
  settingsRoute,
]);

type RouterOptions = {
  /** Defaults to the browser's history; tests pass a memory history. */
  history?: RouterHistory;
};

export function createAppRouter({ history }: RouterOptions = {}) {
  return createRouter({ routeTree, history });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
}
