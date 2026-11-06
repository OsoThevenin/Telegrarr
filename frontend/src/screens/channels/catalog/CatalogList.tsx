import { Accordion } from "@/components/ui/accordion";
import { useI18n } from "@/i18n/use-i18n";
import {
  isFilm,
  shownRange,
  type CatalogPage,
  type CatalogView,
  type FilmRow as Film,
  type FilmStatus,
} from "@/screens/channels/catalog/catalog";
import { CatalogPagination } from "@/screens/channels/catalog/CatalogPagination";
import { FilmRow, UnidentifiedFilmRow } from "@/screens/channels/catalog/FilmRow";

/** Radarr's answer when there is one; a status-filtered page carries its own until then. */
const statusOfRow = (film: Film, statuses: ReadonlyMap<number, FilmStatus>): FilmStatus | undefined =>
  statuses.get(film.tmdb_id) ?? (film.status ? { ...film, status: film.status } : undefined);

type Props = {
  channelId: number;
  page: CatalogPage;
  view: CatalogView;
  lastPage: number;
  isStale: boolean;
  statuses: ReadonlyMap<number, FilmStatus>;
  isAvailable: boolean | null;
  isChecking: boolean;
  pendingIds: readonly number[];
  posterOf: (tmdbId: number) => string | null;
  onDownload: (film: Film) => void;
  onPage: (page: number) => void;
};

export function CatalogList({
  channelId,
  page: { rows, count },
  view,
  lastPage,
  isStale,
  statuses,
  isAvailable,
  isChecking,
  pendingIds,
  posterOf,
  onDownload,
  onPage,
}: Props) {
  const { t, tn } = useI18n();
  const footer = view.q
    ? tn("cat.results", count)
    : t("cat.showing", { shown: shownRange(view.page, rows.length), total: count });

  return (
    <>
      <Accordion asChild type="multiple">
        <ul aria-busy={isStale}>
          {rows.map((row) =>
            isFilm(row) ? (
              <FilmRow
                key={row.tmdb_id}
                channelId={channelId}
                film={row}
                status={statusOfRow(row, statuses)}
                poster={posterOf(row.tmdb_id)}
                isAvailable={isAvailable}
                isChecking={isChecking}
                isDownloading={pendingIds.includes(row.tmdb_id)}
                onDownload={onDownload}
              />
            ) : (
              <UnidentifiedFilmRow key={`message-${row.review.message_id}`} row={row} />
            ),
          )}
        </ul>
      </Accordion>
      <p aria-live="polite" className="text-muted-foreground">
        {footer}
      </p>
      {lastPage > 1 && <CatalogPagination page={view.page} total={lastPage} onPage={onPage} />}
    </>
  );
}
