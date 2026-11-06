import { useState } from "react";

import { Link } from "@tanstack/react-router";

import { AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n/use-i18n";
import {
  filmAction,
  formatBytes,
  type FilmRow as Film,
  type FilmStatus,
  type UnidentifiedRow as Unidentified,
} from "@/screens/channels/catalog/catalog";
import { FilmDetails } from "@/screens/channels/catalog/FilmDetails";

/** The grounds behind a tile with no art, as the old Catalog picks them. */
const TILE_TONES = [
  "#8a6a3c",
  "#6b4fa0",
  "#b8436f",
  "#2e2a26",
  "#7a2f4f",
  "#c0532f",
  "#6f7d3a",
  "#4d7a8a",
  "#3a4630",
];
const TILE_TITLE_LENGTH = 22;

const tileTitle = (title: string) =>
  title.length > TILE_TITLE_LENGTH ? `${title.slice(0, TILE_TITLE_LENGTH - 1)}…` : title;

const metaLine = ({ quality, size, language }: Pick<Film, "quality" | "size" | "language">) =>
  [quality, size ? formatBytes(size) : null, language].filter(Boolean).join(" · ");

const TILE_CLASS = "relative flex h-[66px] w-11 shrink-0 items-center justify-center overflow-hidden rounded-sm";

type PosterProps = {
  film: Film;
  poster: string | null;
};

/** A coloured title tile, covered by the poster when there is one that loads. */
function FilmPoster({ film, poster }: PosterProps) {
  const [brokenPoster, setBrokenPoster] = useState<string | null>(null);
  const background = TILE_TONES[Math.abs(film.tmdb_id) % TILE_TONES.length];

  return (
    <span aria-hidden className={TILE_CLASS} style={{ backgroundColor: background }}>
      <span className="line-clamp-4 px-0.5 text-center text-[8px] leading-tight font-medium break-words text-white uppercase">
        {tileTitle(film.title)}
      </span>
      {poster && poster !== brokenPoster && (
        <img
          src={poster}
          alt=""
          loading="lazy"
          className="absolute inset-0 size-full object-cover"
          onError={() => setBrokenPoster(poster)}
        />
      )}
    </span>
  );
}

function StatusBadges({ status }: { status: FilmStatus | undefined }) {
  const { t } = useI18n();
  if (!status) return null;
  const { status: state, radarr_quality: quality } = status;
  const downloadedText = state === "downloaded" ? t("cat.downloaded") : t("cat.downloaded_at", { quality });

  return (
    <>
      {quality && <Badge variant="secondary">{downloadedText}</Badge>}
      {state === "upgrade" && <Badge variant="outline">{t("cat.upgrade")}</Badge>}
    </>
  );
}

type ActionProps = {
  film: Film;
  status: FilmStatus | undefined;
  /** null while Radarr is being checked. */
  isAvailable: boolean | null;
  isChecking: boolean;
  isDownloading: boolean;
  onDownload: (film: Film) => void;
};

function FilmAction({ film, status, isAvailable, isChecking, isDownloading, onDownload }: ActionProps) {
  const { t } = useI18n();
  if (isAvailable === null || (isAvailable && !status && isChecking)) {
    return <Skeleton className="h-7 w-16" />;
  }

  const action = filmAction(status, isAvailable);
  if (!action) return null;
  if (action.kind === "requested") {
    return (
      <Button size="sm" variant="outline" disabled>
        {t("cat.requested")}
      </Button>
    );
  }

  const isUpgrade = action.kind === "upgrade";
  const label = isUpgrade
    ? t("cat.upgrade_aria", { from: action.from, to: action.to })
    : t("cat.download_aria", { title: film.title });

  return (
    <Button
      size="sm"
      aria-label={label}
      title={isUpgrade ? label : undefined}
      disabled={isDownloading || (!isUpgrade && action.isDisabled)}
      onClick={() => onDownload(film)}
    >
      {isUpgrade ? t("cat.download_quality", { quality: action.to }) : t("cat.download")}
    </Button>
  );
}

type FilmRowProps = ActionProps & {
  poster: string | null;
};

/** The Download action sits beside the trigger, because a button can't hold a button. */
export function FilmRow({ film, status, poster, ...action }: FilmRowProps) {
  return (
    <AccordionItem
      asChild
      value={`film-${film.tmdb_id}`}
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 [&>[data-slot=accordion-content]]:col-span-2"
    >
      <li>
        <AccordionTrigger className="items-center gap-3 hover:no-underline">
          <FilmPoster film={film} poster={poster} />
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="truncate">
              {film.title}{" "}
              {film.year && <span className="ml-0.5 font-normal text-muted-foreground">{film.year}</span>}
            </span>
            <span className="truncate font-normal text-muted-foreground">{metaLine(film)}</span>{" "}
            <span className="flex flex-wrap gap-1 empty:hidden">
              <StatusBadges status={status} />
            </span>
          </span>
        </AccordionTrigger>
        <FilmAction film={film} status={status} {...action} />
        <AccordionContent>
          <FilmDetails film={film} status={status} />
        </AccordionContent>
      </li>
    </AccordionItem>
  );
}

/** A message waiting in Review: it has no film to expand or to download yet. */
export function UnidentifiedFilmRow({ row }: { row: Unidentified }) {
  const { t } = useI18n();

  return (
    <li className="flex items-center gap-3 py-2.5 not-last:border-b">
      <span aria-hidden className={`${TILE_CLASS} border border-dashed text-muted-foreground`}>
        ?
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate font-medium">{row.title}</span>
        <span className="truncate text-muted-foreground">{metaLine(row)}</span>
        <Badge variant="outline">{t("cat.needs_id")}</Badge>
      </span>
      <Button asChild size="sm" variant="outline">
        <Link to="/review" aria-label={t("cat.review_aria", { file: row.title })}>
          {t("cat.review")}
        </Link>
      </Button>
    </li>
  );
}
