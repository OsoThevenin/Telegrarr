import { createRoute } from "@tanstack/react-router";

import { shellRoute } from "@/app/shell-route";
import { AddChannelButton } from "@/screens/channels/AddChannelButton";
import { ChannelsScreen } from "@/screens/channels/ChannelsScreen";

export const channelsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "channels",
  staticData: { titleKey: "nav.channels", HeaderAction: AddChannelButton },
  validateSearch: (search: Record<string, unknown>): { add?: true } => (search.add === true ? { add: true } : {}),
  component: ChannelsScreen,
});
