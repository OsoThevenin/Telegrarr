import { useI18n } from "@/i18n/use-i18n";
import { formatBytes, type FilmRow, type FilmStatus } from "@/screens/channels/catalog/catalog";

type Props = {
  film: FilmRow;
  status: FilmStatus | undefined;
};

/** What the Catalog knows about a film: the expanded row. */
export function FilmDetails({ film, status }: Props) {
  const { t } = useI18n();
  const details = [
    { label: t("cat.detail.quality"), value: film.quality },
    { label: t("cat.detail.size"), value: film.size ? formatBytes(film.size) : null },
    { label: t("cat.detail.language"), value: film.language },
    { label: t("cat.detail.radarr_quality"), value: status?.radarr_quality },
    { label: t("cat.detail.best_quality"), value: status?.best_quality },
    { label: "IMDb", value: film.imdb_id },
    { label: "TMDB", value: String(film.tmdb_id) },
  ];

  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
      {details
        .filter(({ value }) => value)
        .map(({ label, value }) => (
          <div key={label} className="min-w-0">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="truncate">{value}</dd>
          </div>
        ))}
    </dl>
  );
}
