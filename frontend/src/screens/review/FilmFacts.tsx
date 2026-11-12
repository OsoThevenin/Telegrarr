import { cn } from "@/lib/utils";

import { otherTitle } from "./film-text";
import type { FilmHit } from "./review-api";

type Props = {
  film: FilmHit;
  /** The synopsis too, for the film being looked at. */
  isDetailed: boolean;
};

/** Title, year and original title; plus the synopsis when detailed. */
export function FilmFacts({ film, isDetailed }: Props) {
  const original = otherTitle(film);

  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="text-sm font-medium wrap-anywhere">
        {film.title}
        {film.year && <span className="font-normal text-muted-foreground tabular-nums"> ({film.year})</span>}
      </span>
      {original && <span className="text-xs text-muted-foreground wrap-anywhere">{original}</span>}
      {isDetailed && film.overview && (
        <span className={cn("mt-1.5 line-clamp-5 max-w-prose text-xs/relaxed text-muted-foreground sm:line-clamp-4")}>
          {film.overview}
        </span>
      )}
    </span>
  );
}
