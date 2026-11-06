import { useRef, useState, type RefObject } from "react";

import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/i18n/use-i18n";
import { ChannelCard } from "@/screens/channels/ChannelCard";
import { ChannelEditDialog } from "@/screens/channels/ChannelEditDialog";
import { ChannelSheet } from "@/screens/channels/ChannelSheet";
import { NoticeLine } from "@/screens/channels/NoticeLine";
import { RemoveDialog, type Removal } from "@/screens/channels/RemoveDialog";
import { groupIntoShows, tabOf, type Channel, type ChannelTab, type Show } from "@/screens/channels/channel";
import { useChannelActions, useNotice, type Notify } from "@/screens/channels/channel-actions";
import type { ChannelControls } from "@/screens/channels/channel-controls";
import { useChannels } from "@/screens/channels/queries";
import { useOverlay } from "@/screens/channels/use-overlay";

const showsOn = (tab: ChannelTab, channels: Channel[]) =>
  groupIntoShows(channels.filter((channel) => tabOf(channel) === tab));

export function ChannelsScreen() {
  const { t, errorText } = useI18n();
  const channels = useChannels();

  if (channels.isPending) return <p className="text-muted-foreground">{t("common.loading")}</p>;
  if (channels.isError) return <p role="alert">{errorText(channels.error)}</p>;
  if (channels.data.length === 0) return <EmptyList />;

  return <ChannelBrowser channels={channels.data} />;
}

/** What can be open over the grid, and the controls that open it. */
function useChannelOverlays(page: RefObject<HTMLElement | null>, notify: Notify) {
  const { t } = useI18n();
  const sheet = useOverlay<Show["key"]>(page);
  const removal = useOverlay<Removal>(page);
  const editing = useOverlay<Channel>(page);
  const actions = useChannelActions(notify);

  const controls: ChannelControls = {
    actions,
    openShow: (show, opener) => sheet.open(show.key, opener),
    editSource: editing.open,
    askToRemove: removal.open,
  };

  const confirmRemoval = async ({ source, isWholeShow }: Removal) => {
    const isRemoved = await actions.remove(source, t(isWholeShow ? "ch.removed" : "ch.source_removed"));
    if (isRemoved && isWholeShow) sheet.close();
  };

  const confirmSaved = () => {
    notify({ tone: "ok", text: t("chm.updated") });
    editing.close();
  };

  return { sheet, removal, editing, controls, confirmRemoval, confirmSaved };
}

function ChannelBrowser({ channels }: { channels: Channel[] }) {
  const [tab, setTab] = useState<ChannelTab>("series");
  const [notice, notify] = useNotice();
  const page = useRef<HTMLDivElement>(null);
  const { sheet, removal, editing, controls, confirmRemoval, confirmSaved } = useChannelOverlays(page, notify);

  const shows = { series: showsOn("series", channels), movies: showsOn("movies", channels) };
  // Looked up on every render, so the Sheet follows the list as its sources change.
  const sheetShow = shows[tab].find(({ key }) => key === sheet.target);
  const removing = removal.target;

  return (
    <div ref={page} tabIndex={-1} className="outline-none">
      <NoticeLine notice={sheetShow && sheet.isOpen ? null : notice} />
      <ChannelTabs tab={tab} onTabChange={setTab} series={shows.series} movies={shows.movies} controls={controls} />
      {sheetShow && (
        <ChannelSheet
          show={sheetShow}
          isOpen={sheet.isOpen}
          notice={notice}
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
    </div>
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
    <div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-4">
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
      <p className="text-muted-foreground">{t("ch.empty_body")}</p>
    </div>
  );
}
