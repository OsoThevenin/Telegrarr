import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/i18n/use-i18n";
import { ChannelPoster } from "@/screens/channels/ChannelPoster";
import { showTitle, type Show } from "@/screens/channels/channel";
import { useShowPoster } from "@/screens/channels/queries";

type Props = {
  show: Show;
};

export function ChannelCard({ show }: Props) {
  const { tn } = useI18n();
  const title = showTitle(show);
  const poster = useShowPoster(show);

  return (
    <article className="flex h-full flex-col overflow-hidden rounded-xl border bg-card">
      <button type="button" className="flex flex-1 flex-col text-left">
        <ChannelPoster title={title} url={poster} />
        <span className="truncate font-medium" title={title}>
          {title}
        </span>
        {show.sources.length > 1 && <Badge variant="secondary">{tn("ch.sources", show.sources.length)}</Badge>}
      </button>
    </article>
  );
}
