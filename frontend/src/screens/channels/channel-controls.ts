import type { Channel, Show } from "@/screens/channels/channel";
import type { ChannelActions } from "@/screens/channels/channel-actions";
import type { Removal } from "@/screens/channels/RemoveDialog";
import type { Opener } from "@/screens/channels/use-overlay";

/** What a card or the Sheet can ask of the screen. An overlay gives focus back to its `opener`. */
export type ChannelControls = {
  actions: ChannelActions;
  openShow: (show: Show, opener: Opener) => void;
  editSource: (source: Channel, opener: Opener) => void;
  askToRemove: (removal: Removal, opener: Opener) => void;
};
