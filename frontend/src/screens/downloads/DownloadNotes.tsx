import { useI18n } from "@/i18n/use-i18n";
import type { Download } from "@/lib/downloads";
import { isPaused } from "@/screens/downloads/download-list";

const CHANNEL_NUMBERING = "channel";
const EPISODE_DIGITS = 2;

const episodeTag = (episode: number): string => `E${String(episode).padStart(EPISODE_DIGITS, "0")}`;

type Note = {
  text: string;
  title?: string;
};

/** How the episode number was settled, once something checked it. */
function useEpisodeNote({ episode, parsed_episode, episode_source }: Download): Note | null {
  const { t } = useI18n();

  if (parsed_episode == null || episode == null || !episode_source) return null;
  const ep = episodeTag(episode);
  if (episode_source === CHANNEL_NUMBERING) return { text: t("ep.kept", { ep }), title: t("ep.kept_title") };

  const via = t(`ep.source.${episode_source}`);
  const shownVia = via === `ep.source.${episode_source}` ? episode_source : via;
  if (parsed_episode === episode) return { text: t("ep.checked", { ep, via: shownVia }) };
  return { text: t("ep.resolved", { from: episodeTag(parsed_episode), to: ep, via: shownVia }) };
}

type Props = {
  download: Download;
};

export function DownloadNotes({ download }: Props) {
  const { t, msg } = useI18n();
  const episodeNote = useEpisodeNote(download);
  const failure = download.error_msg ? msg(download.error_msg) : download.error;

  return (
    <>
      {episodeNote && (
        <p className="text-sm text-muted-foreground" title={episodeNote.title}>
          {episodeNote.text}
        </p>
      )}
      {isPaused(download) && <p className="text-sm text-muted-foreground">{t("dl.paused_note")}</p>}
      {failure && <p className="text-sm text-destructive wrap-anywhere">{failure}</p>}
    </>
  );
}
