import { useRef, useState, type RefObject } from "react";

import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/i18n/use-i18n";
import { AddChannelButton } from "@/screens/channels/AddChannelButton";
import { AddChannelDialog } from "@/screens/channels/AddChannelDialog";
import { ChannelCard } from "@/screens/channels/ChannelCard";
import { ChannelEditDialog } from "@/screens/channels/ChannelEditDialog";
import { ChannelSheet } from "@/screens/channels/ChannelSheet";
import { RemoveDialog, type Removal } from "@/screens/channels/RemoveDialog";
import { groupIntoShows, tabOf, type Channel, type ChannelTab, type Show } from "@/screens/channels/channel";
import { useChannelActions } from "@/screens/channels/channel-actions";
import type { ChannelControls } from "@/screens/channels/channel-controls";
import { useChannels } from "@/screens/channels/queries";
import { useOverlay } from "@/screens/channels/use-overlay";

const showsOn = (tab: ChannelTab, channels: Channel[]) =>
  groupIntoShows(channels.filter((channel) => tabOf(channel) === tab));

/** Add channel sits above the list's states: adding the first channel changes which one shows. */
export function ChannelsScreen() {
  const [tab, setTab] = useState<ChannelTab>("series");
  const page = useRef<HTMLDivElement>(null);

  return (
    <div ref={page} tabIndex={-1} className="outline-none">
      <ChannelList tab={tab} onTabChange={setTab} page={page} />
      <AddChannelDialog focusFallback={page} onAdded={([first]) => first && setTab(tabOf(first))} />
    </div>
  );
}

type ChannelListProps = {
  tab: ChannelTab;
  onTabChange: (tab: ChannelTab) => void;
  page: RefObject<HTMLElement | null>;
};

function ChannelList({ tab, onTabChange, page }: ChannelListProps) {
  const { t, errorText } = useI18n();
  const channels = useChannels();

  if (channels.isPending) return <p className="text-muted-foreground">{t("common.loading")}</p>;
  if (channels.isError) return <p role="alert">{errorText(channels.error)}</p>;
  if (channels.data.length === 0) return <EmptyList />;

  return <ChannelBrowser channels={channels.data} tab={tab} onTabChange={onTabChange} page={page} />;
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

function ChannelBrowser({ channels, tab, onTabChange, page }: ChannelBrowserProps) {
  const { sheet, removal, editing, controls, confirmRemoval, confirmSaved } = useChannelOverlays(page);

  const shows = { series: showsOn("series", channels), movies: showsOn("movies", channels) };
  // Looked up on every render, so the Sheet follows the list as its sources change. By source:
  // a mapping changes a show's key. On both tabs: an edit can move an open show to the other one.
  const sheetShow = [...shows.series, ...shows.movies].find(({ sources }) =>
    sources.some(({ id }) => sheet.target?.includes(id)),
  );
  const removing = removal.target;

  return (
    <>
      <ChannelTabs tab={tab} onTabChange={onTabChange} series={shows.series} movies={shows.movies} controls={controls} />
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

type ChannelTabsProps = {
  tab: ChannelTab;
  onTabChange: (tab: ChannelTab) => void;
  series: Show[];
  movies: Show[];
  controls: ChannelControls;
};

function ChannelTabs({ tab, onTabChange, series, movies, controls }: ChannelTabsProps) {
  const { t } = useI18n();

  return (
    <Tabs value={tab} onValueChange={(value) => onTabChange(value as ChannelTab)}>
      <TabsList>
        <TabsTrigger value="series">
          {t("ch.tab.series")}
          <Badge variant="secondary">{series.length}</Badge>
        </TabsTrigger>
        <TabsTrigger value="movies">
          {t("ch.tab.movies")}
          <Badge variant="secondary">{movies.length}</Badge>
        </TabsTrigger>
      </TabsList>
      <TabsContent value="series">
        <ShowGrid shows={series} emptyText={t("ch.empty_series")} controls={controls} />
      </TabsContent>
      <TabsContent value="movies">
        <ShowGrid shows={movies} emptyText={t("ch.empty_movies")} controls={controls} />
      </TabsContent>
    </Tabs>
  );
}

type ShowGridProps = {
  shows: Show[];
  emptyText: string;
  controls: ChannelControls;
};

function ShowGrid({ shows, emptyText, controls }: ShowGridProps) {
  if (shows.length === 0) return <p className="py-8 text-center text-muted-foreground">{emptyText}</p>;

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-4 pt-2">
      {shows.map((show) => (
        <ChannelCard key={show.key} show={show} controls={controls} />
      ))}
    </div>
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
