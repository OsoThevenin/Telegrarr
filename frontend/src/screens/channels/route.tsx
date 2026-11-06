import { createRoute } from "@tanstack/react-router";

import { shellRoute } from "@/app/shell-route";
import { ChannelsScreen } from "@/screens/channels/ChannelsScreen";

export const channelsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "channels",
  staticData: { titleKey: "nav.channels" },
  component: ChannelsScreen,
});
