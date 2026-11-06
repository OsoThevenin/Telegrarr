import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/i18n/use-i18n";
import { ChannelCard } from "@/screens/channels/ChannelCard";
import { groupIntoShows, tabOf, type Channel, type ChannelTab } from "@/screens/channels/channel";
import { useChannels } from "@/screens/channels/queries";

const showsOn = (tab: ChannelTab, channels: Channel[]) =>
  groupIntoShows(channels.filter((channel) => tabOf(channel) === tab));

export function ChannelsScreen() {
  const { t, errorText } = useI18n();
  const channels = useChannels();
  const [tab, setTab] = useState<ChannelTab>("series");

  if (channels.isPending) return <p className="text-muted-foreground">{t("common.loading")}</p>;
  if (channels.isError) return <p role="alert">{errorText(channels.error)}</p>;
  if (channels.data.length === 0) return <EmptyList />;

  const series = showsOn("series", channels.data);
  const movies = showsOn("movies", channels.data);

  return (
    <Tabs value={tab} onValueChange={(value) => setTab(value as ChannelTab)}>
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
        <ShowGrid shows={series} emptyText={t("ch.empty_series")} />
      </TabsContent>
      <TabsContent value="movies">
        <ShowGrid shows={movies} emptyText={t("ch.empty_movies")} />
      </TabsContent>
    </Tabs>
  );
}

function ShowGrid({ shows, emptyText }: { shows: ReturnType<typeof groupIntoShows>; emptyText: string }) {
  if (shows.length === 0) return <p className="py-8 text-center text-muted-foreground">{emptyText}</p>;

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-4">
      {shows.map((show) => (
        <ChannelCard key={show.key} show={show} />
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
