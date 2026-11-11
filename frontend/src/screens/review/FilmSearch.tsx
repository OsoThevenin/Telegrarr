import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n/use-i18n";

import { FilmHitCard } from "./FilmHitCard";
import { searchFilms, type FilmHit } from "./review-api";
import { useDebounced } from "./use-debounced";

const MIN_QUERY_LENGTH = 2;

type Props = {
  initialQuery: string;
  /** The release's parsed year: narrows the search for its own title. */
  year: number | null;
  shouldFocus: boolean;
  isDisabled: boolean;
  selected: FilmHit | null;
  /** The hit being assigned, if one is. */
  assigning: FilmHit | null;
  onSelect: (film: FilmHit) => void;
  onAssign: (film: FilmHit) => void;
};

type SearchState = { isFetching: boolean; data: FilmHit[] | undefined };

/** One sentence for the live status: searching, nothing found, or how many hits. */
function useSearchStatus({ isFetching, data }: SearchState): string {
  const { t, tn } = useI18n();
  if (isFetching) return t("review.searching");
  if (!data) return "";
  return data.length === 0 ? t("review.no_films") : tn("review.results", data.length);
}

export function FilmSearch(props: Props) {
  const { initialQuery, year, shouldFocus, isDisabled, selected, assigning, onSelect, onAssign } = props;
  const { t, errorText } = useI18n();
  const [query, setQuery] = useState(initialQuery);
  const term = useDebounced(query).trim();
  // The year belongs to the release's own title; a title the user typed may be another film.
  const searchYear = term === initialQuery.trim() ? year : null;
  const films = useQuery({
    queryKey: ["tmdb", "movies", term, searchYear],
    queryFn: () => searchFilms(term, searchYear),
    enabled: term.length >= MIN_QUERY_LENGTH,
  });
  const status = useSearchStatus(films);

  return (
    <div className="flex flex-col gap-2">
      <Input
        type="search"
        aria-label={t("review.search_placeholder")}
        placeholder={t("review.search_placeholder")}
        value={query}
        autoFocus={shouldFocus}
        onChange={(event) => setQuery(event.target.value)}
        className="h-11 sm:h-9"
      />
      <p role="status" aria-live="polite" className="text-sm text-muted-foreground empty:hidden">
        {status}
      </p>
      {films.isError && (
        <p role="alert" className="text-sm text-destructive">
          {errorText(films.error)}
        </p>
      )}
      {films.data && films.data.length > 0 && (
        <>
          <p className="text-xs text-muted-foreground">{t("review.hits_hint")}</p>
          <ul className="flex flex-col gap-0.5">
            {films.data.map((film) => (
              <FilmHitCard
                key={film.tmdb_id}
                film={film}
                isSelected={selected?.tmdb_id === film.tmdb_id}
                isAssigning={assigning?.tmdb_id === film.tmdb_id}
                isDisabled={isDisabled}
                onSelect={() => onSelect(film)}
                onAssign={() => onAssign(film)}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
