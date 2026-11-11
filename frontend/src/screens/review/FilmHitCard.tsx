import { useQuery } from "@tanstack/react-query";
import { Loader2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/use-i18n";
import { cn } from "@/lib/utils";

import { FilmFacts } from "./FilmFacts";
import { FilmLinks } from "./FilmLinks";
import { FilmPoster } from "./FilmPoster";
import { filmLabel } from "./film-text";
import { previewFilm, type FilmHit } from "./review-api";

type Props = {
  film: FilmHit;
  isSelected: boolean;
  isAssigning: boolean;
  isDisabled: boolean;
  onSelect: () => void;
  onAssign: () => void;
};

/** The selected hit's IMDb id: a search hit does not carry one. */
function useImdbId(film: FilmHit, isSelected: boolean): string | null {
  const details = useQuery({
    queryKey: ["tmdb", "movie", String(film.tmdb_id)],
    queryFn: () => previewFilm(film.tmdb_id),
    enabled: isSelected,
  });
  return details.data?.imdb_id ?? null;
}

/** A search hit: a click selects and previews it; Assigna, only shown then, commits it. */
export function FilmHitCard({ film, isSelected, isAssigning, isDisabled, onSelect, onAssign }: Props) {
  const { t } = useI18n();
  const imdbId = useImdbId(film, isSelected);
  const label = filmLabel(film);

  return (
    <li
      aria-busy={isAssigning}
      className={cn(
        "rounded-lg border transition-colors",
        isSelected ? "border-primary/50 bg-background" : "border-transparent",
      )}
    >
      {/* Phones: Assigna spans a row of its own. Wider: it closes the links column, level with the poster's foot. */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-1 p-1">
        <button
          type="button"
          aria-pressed={isSelected}
          aria-label={label}
          disabled={isDisabled}
          onClick={onSelect}
          className="flex min-h-11 min-w-0 items-start gap-3 rounded-md p-1 text-left outline-none hover:bg-muted/70 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60 aria-pressed:hover:bg-transparent sm:row-span-2"
        >
          <FilmPoster url={film.poster} size={isSelected ? "preview" : "thumb"} />
          <FilmFacts film={film} isDetailed={isSelected} />
        </button>
        <FilmLinks film={film} imdbId={isSelected ? imdbId : null} />
        {isSelected && (
          <Button
            type="button"
            size="lg"
            disabled={isDisabled}
            aria-label={isAssigning ? undefined : t("review.assign_film", { film: label })}
            onClick={onAssign}
            className="col-span-2 m-1 h-11 sm:col-span-1 sm:col-start-2 sm:mt-0 sm:h-9 sm:self-end"
          >
            {isAssigning && <Loader2Icon aria-hidden className="animate-spin" />}
            {isAssigning ? t("review.assigning") : t("review.assign")}
          </Button>
        )}
      </div>
    </li>
  );
}
