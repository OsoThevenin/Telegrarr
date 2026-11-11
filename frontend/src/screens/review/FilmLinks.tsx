import { ExternalLinkIcon } from "lucide-react";

import { useI18n } from "@/i18n/use-i18n";

import { filmLabel } from "./film-text";
import { imdbFilmUrl, tmdbFilmUrl, type FilmHit } from "./review-api";

type Props = {
  film: FilmHit;
  imdbId: string | null;
};

type LinkProps = { href: string; label: string; name: string };

/** Its own control: following it never picks the film. */
function ExternalLink({ href, label, name }: LinkProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      className="inline-flex h-11 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground underline-offset-4 outline-none hover:bg-muted hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 sm:h-8"
    >
      {name}
      <ExternalLinkIcon aria-hidden className="size-3.5" />
    </a>
  );
}

/** The film on TMDB and, once known, on IMDb: to check it before assigning it. */
export function FilmLinks({ film, imdbId }: Props) {
  const { t } = useI18n();
  const label = filmLabel(film);

  return (
    <span className="flex shrink-0 flex-col items-end">
      <ExternalLink href={tmdbFilmUrl(film.tmdb_id)} name="TMDB" label={t("review.open_tmdb", { film: label })} />
      {imdbId && <ExternalLink href={imdbFilmUrl(imdbId)} name="IMDb" label={t("review.open_imdb", { film: label })} />}
    </span>
  );
}
