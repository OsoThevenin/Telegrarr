import { useRef, type RefObject } from "react";

import { toast } from "sonner";

import { useI18n } from "@/i18n/use-i18n";
import { AddChannelButton } from "@/screens/channels/AddChannelButton";
import { AddChannelDialog } from "@/screens/channels/AddChannelDialog";
import { ChannelCard } from "@/screens/channels/ChannelCard";
import { ChannelEditDialog } from "@/screens/channels/ChannelEditDialog";
import { ChannelSheet } from "@/screens/channels/ChannelSheet";
import { RemoveDialog, type Removal } from "@/screens/channels/RemoveDialog";
import { groupIntoShows, sortByTitle, type Channel, type Show } from "@/screens/channels/channel";
import { useChannelActions } from "@/screens/channels/channel-actions";
import type { ChannelControls } from "@/screens/channels/channel-controls";
import { useChannels } from "@/screens/channels/queries";
import { useOverlay } from "@/screens/channels/use-overlay";

/** Add channel sits above the list's states: adding the first channel changes which one shows. */
export function ChannelsScreen() {
  const page = useRef<HTMLDivElement>(null);

  return (
    <div ref={page} tabIndex={-1} className="outline-none">
      <ChannelList page={page} />
      <AddChannelDialog focusFallback={page} />
    </div>
  );
}

type ChannelListProps = {
  page: RefObject<HTMLElement | null>;
};

function ChannelList({ page }: ChannelListProps) {
  const { t, errorText } = useI18n();
  const channels = useChannels();

  if (channels.isPending) return <p className="text-muted-foreground">{t("common.loading")}</p>;
  if (channels.isError) return <p role="alert">{errorText(channels.error)}</p>;
  if (channels.data.length === 0) return <EmptyList />;

  return <ChannelBrowser channels={channels.data} page={page} />;
}

/** What can be open over the grid, and the controls that open it. */
function useChannelOverlays(page: RefObject<HTMLElement | null>) {
  const { t } = useI18n();
  const sheet = useOverlay<Channel["id"][]>(page);
  const removal = useOverlay<Removal>(page);
  const editing = useOverlay<Channel>(page);
  const actions = useChannelActions();

  const controls: ChannelControls = {
    actions,
    openShow: ({ sources }, opener) => sheet.open(sources.map(({ id }) => id), opener),
    editSource: editing.open,
    askToRemove: removal.open,
  };

  const confirmRemoval = async ({ source, isWholeShow }: Removal) => {
    const isRemoved = await actions.remove(source, t("ch.removed"));
    if (isRemoved && isWholeShow) sheet.close();
  };

  const confirmSaved = () => {
    toast.success(t("chm.updated"));
    editing.close();
  };

  return { sheet, removal, editing, controls, confirmRemoval, confirmSaved };
}

type ChannelBrowserProps = ChannelListProps & { channels: Channel[] };

function ChannelBrowser({ channels, page }: ChannelBrowserProps) {
  const { locale } = useI18n();
  const { sheet, removal, editing, controls, confirmRemoval, confirmSaved } = useChannelOverlays(page);

  const shows = sortByTitle(groupIntoShows(channels), locale);
  // Looked up on every render, so the Sheet follows the list as its sources change. By source:
  // a mapping changes a show's key.
  const sheetShow = shows.find(({ sources }) =>
    sources.some(({ id }) => sheet.target?.includes(id)),
  );
  const removing = removal.target;

  return (
    <>
      <ShowGrid shows={shows} controls={controls} />
      {sheetShow && (
        <ChannelSheet
          show={sheetShow}
          isOpen={sheet.isOpen}
          controls={controls}
          onClose={sheet.close}
          onCloseAutoFocus={sheet.onCloseAutoFocus}
        />
      )}
      {editing.target && (
        <ChannelEditDialog
          source={editing.target}
          isOpen={editing.isOpen}
          onSaved={confirmSaved}
          onClose={editing.close}
          onCloseAutoFocus={editing.onCloseAutoFocus}
        />
      )}
      {removing && (
        <RemoveDialog
          removal={removing}
          isOpen={removal.isOpen}
          onConfirm={() => confirmRemoval(removing)}
          onClose={removal.close}
          onCloseAutoFocus={removal.onCloseAutoFocus}
        />
      )}
    </>
  );
}

type ShowGridProps = {
  shows: Show[];
  controls: ChannelControls;
};

/** Every show, series and movies together, each card saying which kind it is. */
function ShowGrid({ shows, controls }: ShowGridProps) {
  const { t } = useI18n();

  return (
    <ul aria-label={t("nav.channels")} className="grid grid-cols-[repeat(auto-fill,minmax(min(11rem,100%),1fr))] gap-4 max-sm:grid-cols-2 max-sm:gap-3">
      {shows.map((show) => (
        <li key={show.key} className="min-w-0">
          <ChannelCard show={show} controls={controls} />
        </li>
      ))}
    </ul>
  );
}

function EmptyList() {
  const { t } = useI18n();

  return (
    <div className="py-12 text-center">
      <h2 className="font-medium">{t("ch.empty_title")}</h2>
      <p className="mb-4 text-muted-foreground">{t("ch.empty_body")}</p>
      <AddChannelButton />
    </div>
  );
}
