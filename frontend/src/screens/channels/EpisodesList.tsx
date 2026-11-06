import { useId } from "react";

import { useI18n } from "@/i18n/use-i18n";
import type { Show } from "@/screens/channels/channel";
import { useCompletedDownloads, type CompletedDownload } from "@/screens/channels/queries";

const MAX_LISTED = 60;
const BYTES_PER_GB = 1e9;

const episodeName = ({ save_path, file_name }: CompletedDownload) =>
  save_path?.split("/").pop() || file_name || "";

const episodesOf = ({ sources }: Show, downloads: CompletedDownload[]) => {
  const sourceIds = new Set(sources.map(({ id }) => id));

  return downloads
    .filter(({ channel_id }) => sourceIds.has(channel_id))
    .toSorted((a, b) => (b.finished_at ?? 0) - (a.finished_at ?? 0));
};

type Props = {
  show: Show;
};

/** The show's finished downloads. It fetches them itself: the screen holds no download data. */
export function EpisodesList({ show }: Props) {
  const { t, tn, errorText } = useI18n();
  const downloads = useCompletedDownloads();
  const headingId = useId();

  if (downloads.isPending) return <p className="text-muted-foreground">{t("common.loading")}</p>;
  if (downloads.isError) return <p className="text-destructive">{errorText(downloads.error)}</p>;

  const episodes = episodesOf(show, downloads.data);

  return (
    <section className="flex flex-col gap-2">
      <h3 id={headingId} className="font-medium">
        {tn("ch.episodes_downloaded", episodes.length)}
      </h3>
      {episodes.length === 0 ? (
        <p className="text-muted-foreground">{t("dash.no_downloads")}</p>
      ) : (
        <ul aria-labelledby={headingId} className="flex flex-col gap-1">
          {episodes.slice(0, MAX_LISTED).map((episode) => (
            <li key={episode.id} className="flex justify-between gap-3">
              <span className="min-w-0 truncate" title={episodeName(episode)}>
                {episodeName(episode)}
              </span>
              {Boolean(episode.file_size) && (
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  {`${((episode.file_size ?? 0) / BYTES_PER_GB).toFixed(2)} GB`}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
