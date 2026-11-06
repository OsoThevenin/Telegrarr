import { useRef, useState } from "react";

import { useI18n } from "@/i18n/use-i18n";
import { chipStates, isFilm, pageCount } from "@/screens/channels/catalog/catalog";
import { CatalogList } from "@/screens/channels/catalog/CatalogList";
import { CatalogToolbar } from "@/screens/channels/catalog/CatalogToolbar";
import {
  DownloadNotice,
  EmptyCatalog,
  LoadFailed,
  NoResults,
  RadarrIndicator,
  RadarrOffline,
} from "@/screens/channels/catalog/notices";
import {
  useCatalogPage,
  useCatalogPosters,
  useCatalogStatus,
  useFilmDownload,
} from "@/screens/channels/catalog/queries";
import { useCatalogView } from "@/screens/channels/catalog/use-catalog-view";
import type { Channel } from "@/screens/channels/channel";
import { useChannelActions } from "@/screens/channels/channel-actions";

type Props = {
  channel: Channel;
};

/** The Catalog of a movie channel, as it renders inside the channel's Sheet. */
export function CatalogSection({ channel }: Props) {
  const { t, tn } = useI18n();
  const section = useRef<HTMLElement>(null);
  const { view, searchText, changeSearch, clearSearch, pickFilter, goToPage } = useCatalogView();
  const page = useCatalogPage(channel.id, view);
  const rows = page.data?.rows ?? [];
  const { isAvailable, statuses, counts, isChecking } = useCatalogStatus(channel.id, rows);
  const isStatusSettled = isAvailable !== null && !isChecking;
  const posterOf = useCatalogPosters(channel.id, rows.filter(isFilm), statuses, isStatusSettled);
  const { download, pendingIds, failure, dismissFailure } = useFilmDownload(channel.id);
  const { scan } = useChannelActions();
  const [isScanning, setIsScanning] = useState(false);

  const total = page.data?.counts.all ?? counts?.all;
  const lastPage = pageCount(page.data?.count ?? 0);

  // The page on screen can stop existing when rows go away under it.
  if (page.data && !page.isPlaceholderData && view.page > lastPage) goToPage(lastPage);

  const handlePage = (target: number) => {
    goToPage(target);
    section.current?.scrollIntoView({ block: "start" });
  };
  const handleScan = async () => {
    setIsScanning(true);
    await scan([channel]);
    setIsScanning(false);
  };

  const renderBody = () => {
    if (page.isPending) return <p className="text-muted-foreground">{t("common.loading")}</p>;
    if (page.isError) return <LoadFailed error={page.error} onRetry={() => void page.refetch()} />;
    if (total === 0) {
      return <EmptyCatalog channel={channel} isScanning={isScanning} onScan={() => void handleScan()} />;
    }
    if (view.q && rows.length === 0) return <NoResults q={view.q} onClear={clearSearch} />;
    if (rows.length === 0) return <p className="py-4 text-muted-foreground">{t("cat.filter_empty")}</p>;

    return (
      <CatalogList
        channelId={channel.id}
        page={page.data}
        view={view}
        lastPage={lastPage}
        isStale={page.isPlaceholderData}
        statuses={statuses}
        isAvailable={isAvailable}
        isChecking={isChecking}
        pendingIds={pendingIds}
        posterOf={posterOf}
        onDownload={(film) => void download(film)}
        onPage={handlePage}
      />
    );
  };

  return (
    <section ref={section} className="flex scroll-mt-4 flex-col gap-3">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="flex items-baseline gap-2">
          <h3 className="font-medium">{t("cat.title")}</h3>
          {total !== undefined && <p className="text-muted-foreground">{tn("cat.films", total)}</p>}
        </div>
        <RadarrIndicator isAvailable={isAvailable} />
      </header>
      {isAvailable === false && <RadarrOffline />}
      {total !== 0 && (
        <CatalogToolbar
          searchText={searchText}
          chips={chipStates(counts && { ...counts, all: total ?? counts.all }, isAvailable, view.filter)}
          total={total ?? 0}
          onSearch={changeSearch}
          onFilter={pickFilter}
        />
      )}
      {renderBody()}
      {failure && (
        <DownloadNotice failure={failure} onRetry={() => void download(failure.film)} onDismiss={dismissFailure} />
      )}
    </section>
  );
}
