import { useQuery } from "@tanstack/react-query";
import { Loader2Icon } from "lucide-react";
import type { FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n/use-i18n";

import { FilmFacts } from "./FilmFacts";
import { FilmLinks } from "./FilmLinks";
import { FilmPoster } from "./FilmPoster";
import { previewFilm, type FilmPreview } from "./review-api";
import { useDebounced } from "./use-debounced";

type Props = {
  id: string;
  value: string;
  isBusy: boolean;
  isAssigning: boolean;
  onChange: (value: string) => void;
  onAssign: (typed: string) => void;
};

/** The film the typed text names, once typing settles; stale while the text moves on. */
function useTypedPreview(value: string) {
  const typed = value.trim();
  const term = useDebounced(typed);
  const preview = useQuery({
    queryKey: ["tmdb", "movie", term],
    queryFn: () => previewFilm(term),
    enabled: term.length > 0,
  });
  const isCurrent = term === typed && typed.length > 0;
  return { typed, preview, film: isCurrent ? (preview.data ?? null) : null, isCurrent };
}

function TypedPreview({ film }: { film: FilmPreview }) {
  return (
    <div className="flex items-start gap-1 rounded-lg border border-primary bg-card p-2 ring-3 ring-primary/15">
      <span className="flex min-w-0 flex-1 items-start gap-3">
        <FilmPoster url={film.poster} size="preview" />
        <FilmFacts film={film} isDetailed />
      </span>
      <FilmLinks film={film} imdbId={film.imdb_id} />
    </div>
  );
}

/** A TMDB id, TMDB link or IMDb id: previewed before Assigna takes it. */
export function TypedFilmId({ id, value, isBusy, isAssigning, onChange, onAssign }: Props) {
  const { t, errorText } = useI18n();
  const { typed, preview, film, isCurrent } = useTypedPreview(value);
  const canAssign = film !== null && !isBusy;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (canAssign) onAssign(typed);
  }

  return (
    <form onSubmit={handleSubmit} className="flex min-w-0 flex-1 basis-72 flex-col gap-1.5">
      <label htmlFor={id} className="text-xs text-muted-foreground">
        {t("review.id_placeholder")}
      </label>
      <div className="flex gap-2">
        <Input
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-11 min-w-0 flex-1 sm:h-9"
        />
        <Button type="submit" size="lg" disabled={!canAssign} className="h-11 sm:h-9">
          {isAssigning && <Loader2Icon aria-hidden className="animate-spin" />}
          {isAssigning ? t("review.assigning") : t("review.assign")}
        </Button>
      </div>
      {typed && !isCurrent && <p className="text-xs text-muted-foreground">{t("review.resolving")}</p>}
      {isCurrent && preview.isFetching && !film && (
        <p className="text-xs text-muted-foreground">{t("review.resolving")}</p>
      )}
      {isCurrent && preview.isError && (
        <p role="alert" className="text-sm text-destructive">
          {errorText(preview.error)}
        </p>
      )}
      {film && <TypedPreview film={film} />}
    </form>
  );
}
