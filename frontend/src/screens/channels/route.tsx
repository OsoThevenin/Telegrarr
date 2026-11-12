import { createRoute, lazyRouteComponent } from "@tanstack/react-router";

import { shellRoute } from "@/app/shell-route";
import { AddChannelButton } from "@/screens/channels/AddChannelButton";

export const channelsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "channels",
  staticData: { titleKey: "nav.channels", HeaderAction: AddChannelButton },
  validateSearch: (search: Record<string, unknown>): { add?: true } => (search.add === true ? { add: true } : {}),
  component: lazyRouteComponent(() => import("@/screens/channels/ChannelsScreen"), "ChannelsScreen"),
});
