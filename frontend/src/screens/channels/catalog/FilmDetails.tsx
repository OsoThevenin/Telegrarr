import { useId } from "react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/use-i18n";
import { formatBytes } from "@/lib/format";
import {
  canAskWhyNotGrabbed,
  formatGb,
  type FilmRow,
  type FilmStatus,
  type RadarrFile,
} from "@/screens/channels/catalog/catalog";
import { WhyNotGrabbed } from "@/screens/channels/catalog/WhyNotGrabbed";

type Detail = {
  label: string;
  value: string | null | undefined;
};

/** Leaves out what isn't known. */
function DetailList({ details }: { details: Detail[] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
      {details
        .filter(({ value }) => value)
        .map(({ label, value }) => (
          <div key={label} className="min-w-0">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="truncate" title={value ?? undefined}>
              {value}
            </dd>
          </div>
        ))}
    </dl>
  );
}

function FileDetails({ file }: { file: RadarrFile }) {
  const { t } = useI18n();
  const titleId = useId();
  const details = [
    { label: t("cat.file.quality"), value: file.quality },
    { label: t("cat.file.resolution"), value: file.resolution },
    { label: t("cat.file.video_codec"), value: file.video_codec },
    { label: t("cat.file.container"), value: file.container },
    { label: t("cat.file.audio"), value: file.audio_languages.join(", ") },
    { label: t("cat.file.subtitles"), value: file.subtitle_languages.join(", ") },
    { label: t("cat.detail.size"), value: file.size ? formatGb(file.size) : null },
  ];

  return (
    <div role="group" aria-labelledby={titleId} className="flex flex-col gap-2 border-t pt-3">
      <p id={titleId} className="font-medium">
        {t("cat.file.title")}
      </p>
      <DetailList details={details} />
    </div>
  );
}

type Props = {
  channelId: number;
  film: FilmRow;
  status: FilmStatus | undefined;
};

/** What the Catalog knows about a film: the expanded row. */
export function FilmDetails({ channelId, film, status }: Props) {
  const { t } = useI18n();
  const details = [
    { label: t("cat.detail.quality"), value: film.quality },
    { label: t("cat.detail.size"), value: film.size ? formatBytes(film.size) : null },
    { label: t("cat.detail.language"), value: film.language },
    { label: t("cat.detail.best_quality"), value: status?.best_quality },
    { label: "IMDb", value: film.imdb_id },
    { label: "TMDB", value: String(film.tmdb_id) },
  ];

  return (
    <div className="flex flex-col gap-3">
      <DetailList details={details} />
      {status?.file && <FileDetails file={status.file} />}
      <div className="flex flex-wrap items-center gap-2 empty:hidden">
        {film.radarr_link && (
          <Button asChild variant="outline" size="sm">
            <a
              href={film.radarr_link}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t("cat.open_radarr_aria", { title: film.title })}
            >
              {t("cat.open_radarr")}
            </a>
          </Button>
        )}
        {canAskWhyNotGrabbed(status) && <WhyNotGrabbed channelId={channelId} tmdbId={film.tmdb_id} />}
      </div>
    </div>
  );
}
