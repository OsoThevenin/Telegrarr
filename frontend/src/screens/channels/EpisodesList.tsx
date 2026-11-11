import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/use-i18n";
import { downloadName } from "@/lib/downloads";
import { formatBytes } from "@/lib/format";
import { useFormat } from "@/lib/use-format";
import type { Show } from "@/screens/channels/channel";
import { byEpisodeNewestFirst, parseEpisode, type ParsedEpisode } from "@/screens/channels/episode";
import { useCompletedDownloads, type CompletedDownload } from "@/screens/channels/queries";

/** How many rows show at first, and how many more each press of "Show more" adds. */
const EPISODES_BATCH = 50;

type Episode = ParsedEpisode & {
  id: number;
  fileName: string;
  size: number | null;
  finishedAt: number | null;
};

const toEpisode = (download: CompletedDownload): Episode => {
  const fileName = downloadName(download);
  return {
    ...parseEpisode(fileName),
    id: download.id,
    fileName,
    size: download.file_size,
    finishedAt: download.finished_at,
  };
};

function EpisodeRow({ episode }: { episode: Episode }) {
  const { when } = useFormat();
  const facts = [episode.size ? formatBytes(episode.size) : null, episode.finishedAt ? when(episode.finishedAt) : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className="flex items-baseline gap-3 py-2 not-last:border-b">
      <span data-episode className="w-16 shrink-0 text-muted-foreground tabular-nums">
        {episode.label ?? ""}
      </span>
      <span className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-baseline sm:gap-3">
        <span className="min-w-0 truncate" title={episode.fileName}>
          {episode.title}
        </span>
        {facts && (
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums sm:ml-auto sm:text-sm">{facts}</span>
        )}
      </span>
    </li>
  );
}

type Props = {
  show: Show;
};

/** The show's finished downloads. It fetches them itself: the screen holds no download data. */
export function EpisodesList({ show }: Props) {
  const { t, tn, errorText } = useI18n();
  const downloads = useCompletedDownloads(show.sources.map(({ id }) => id));
  const [shown, setShown] = useState(EPISODES_BATCH);
  const headingId = useId();

  if (downloads.isPending) return <p className="text-muted-foreground">{t("common.loading")}</p>;
  if (downloads.isError) return <p className="text-destructive">{errorText(downloads.error)}</p>;

  const episodes = downloads.data.map(toEpisode).toSorted(byEpisodeNewestFirst);
  const nextBatch = Math.min(episodes.length - shown, EPISODES_BATCH);

  return (
    <section className="flex flex-col gap-2">
      <h3 id={headingId} className="font-medium">
        {tn("ch.episodes_downloaded", episodes.length)}
      </h3>
      {episodes.length === 0 ? (
        <p className="text-muted-foreground">{t("dash.no_downloads")}</p>
      ) : (
        <ul aria-labelledby={headingId} className="flex flex-col">
          {episodes.slice(0, shown).map((episode) => (
            <EpisodeRow key={episode.id} episode={episode} />
          ))}
        </ul>
      )}
      {nextBatch > 0 && (
        <Button variant="outline" className="self-start" onClick={() => setShown(shown + EPISODES_BATCH)}>
          {tn("ch.episodes_more", nextBatch)}
        </Button>
      )}
    </section>
  );
}
