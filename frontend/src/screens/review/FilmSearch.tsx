import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n/use-i18n";

import { searchFilms, type FilmHit } from "./review-api";

const SEARCH_DEBOUNCE_MS = 350;
const MIN_QUERY_LENGTH = 2;

type Props = {
  initialQuery: string;
  shouldFocus: boolean;
  isDisabled: boolean;
  onPick: (film: FilmHit) => void;
};

function filmLabel({ title, year, original_title }: FilmHit): string {
  const dated = year ? `${title} (${year})` : title;
  return original_title && original_title !== title ? `${dated} · ${original_title}` : dated;
}

function useDebounced(value: string): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value]);
  return debounced;
}

export function FilmSearch({ initialQuery, shouldFocus, isDisabled, onPick }: Props) {
  const { t, errorText } = useI18n();
  const [query, setQuery] = useState(initialQuery);
  const term = useDebounced(query).trim();
  const films = useQuery({
    queryKey: ["tmdb", "movies", term],
    queryFn: () => searchFilms(term),
    enabled: term.length >= MIN_QUERY_LENGTH,
  });

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
      {films.isFetching && <p className="text-sm text-muted-foreground">{t("review.searching")}</p>}
      {films.isError && (
        <p role="alert" className="text-sm text-destructive">
          {errorText(films.error)}
        </p>
      )}
      {films.data?.length === 0 && <p className="text-sm text-muted-foreground">{t("review.no_films")}</p>}
      {films.data && films.data.length > 0 && (
        <>
          <p className="text-xs text-muted-foreground">{t("review.hits_hint")}</p>
          <ul className="flex flex-col">
            {films.data.map((film) => (
              <li key={film.tmdb_id}>
                <button
                  type="button"
                  disabled={isDisabled}
                  onClick={() => onPick(film)}
                  className="min-h-11 w-full rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 sm:min-h-8"
                >
                  {filmLabel(film)}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
