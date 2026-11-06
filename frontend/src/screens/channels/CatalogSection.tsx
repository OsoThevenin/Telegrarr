import { useRef, useState } from "react";

import { useI18n } from "@/i18n/use-i18n";
import { chipStates, isFilm, pageCount, type CatalogView } from "@/screens/channels/catalog/catalog";
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

function useCatalogData(channelId: number, view: CatalogView) {
  const page = useCatalogPage(channelId, view);
  const rows = page.data?.rows ?? [];
  const { isAvailable, statuses, counts, isChecking } = useCatalogStatus(channelId, rows);
  const isStatusSettled = isAvailable !== null && !isChecking;
  const posterOf = useCatalogPosters(channelId, rows.filter(isFilm), statuses, isStatusSettled);

  return {
    page,
    rows,
    isAvailable,
    statuses,
    counts,
    isChecking,
    posterOf,
    total: page.data?.counts.all ?? counts?.all,
    lastPage: pageCount(page.data?.count ?? 0),
  };
}

type Props = {
  channel: Channel;
};

function ScanEmptyCatalog({ channel }: Props) {
  const { scan } = useChannelActions();
  const [isScanning, setIsScanning] = useState(false);

  const handleScan = async () => {
    setIsScanning(true);
    await scan([channel]);
    setIsScanning(false);
  };

  return <EmptyCatalog channel={channel} isScanning={isScanning} onScan={() => void handleScan()} />;
}

type BodyProps = Props & {
  data: ReturnType<typeof useCatalogData>;
  view: CatalogView;
  downloads: Pick<ReturnType<typeof useFilmDownload>, "download" | "pendingIds">;
  onClearSearch: () => void;
  onPage: (target: number) => void;
};

function CatalogBody({ channel, data, view, downloads, onClearSearch, onPage }: BodyProps) {
  const { t } = useI18n();
  const { page, rows, total } = data;

  if (page.isPending) return <p className="text-muted-foreground">{t("common.loading")}</p>;
  if (page.isError) return <LoadFailed error={page.error} onRetry={() => void page.refetch()} />;
  if (total === 0) return <ScanEmptyCatalog channel={channel} />;
  if (view.q && rows.length === 0) return <NoResults q={view.q} onClear={onClearSearch} />;
  if (rows.length === 0) return <p className="py-4 text-muted-foreground">{t("cat.filter_empty")}</p>;

  return (
    <CatalogList
      channelId={channel.id}
      page={page.data}
      view={view}
      lastPage={data.lastPage}
      isStale={page.isPlaceholderData}
      statuses={data.statuses}
      isAvailable={data.isAvailable}
      isChecking={data.isChecking}
      pendingIds={downloads.pendingIds}
      posterOf={data.posterOf}
      onDownload={(film) => void downloads.download(film)}
      onPage={onPage}
    />
  );
}

/** The Catalog of a movie channel, as it renders inside the channel's Sheet. */
export function CatalogSection({ channel }: Props) {
  const { t, tn } = useI18n();
  const section = useRef<HTMLElement>(null);
  const { view, searchText, changeSearch, clearSearch, pickFilter, goToPage } = useCatalogView();
  const data = useCatalogData(channel.id, view);
  const { page, isAvailable, counts, total, lastPage } = data;
  const { download, pendingIds, failure, dismissFailure } = useFilmDownload(channel.id);

  // The page on screen can stop existing when rows go away under it.
  if (page.data && !page.isPlaceholderData && view.page > lastPage) goToPage(lastPage);

  const handlePage = (target: number) => {
    goToPage(target);
    section.current?.scrollIntoView({ block: "start" });
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
      <CatalogBody
        channel={channel}
        data={data}
        view={view}
        downloads={{ download, pendingIds }}
        onClearSearch={clearSearch}
        onPage={handlePage}
      />
      {failure && (
        <DownloadNotice failure={failure} onRetry={() => void download(failure.film)} onDismiss={dismissFailure} />
      )}
    </section>
  );
}
