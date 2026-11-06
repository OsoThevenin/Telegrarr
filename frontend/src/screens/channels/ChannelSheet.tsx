import { useId } from "react";

import { ScanLineIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { useI18n } from "@/i18n/use-i18n";
import { CatalogSection } from "@/screens/channels/CatalogSection";
import { ChannelPoster } from "@/screens/channels/ChannelPoster";
import { EpisodesList } from "@/screens/channels/EpisodesList";
import { NoticeLine } from "@/screens/channels/NoticeLine";
import { SourceRow } from "@/screens/channels/SourceRow";
import {
  isMovieChannel,
  isWholeForum,
  kindLabel,
  mappingIds,
  showTitle,
  sourceLabel,
  type Show,
} from "@/screens/channels/channel";
import type { Notice } from "@/screens/channels/channel-actions";
import type { ChannelControls } from "@/screens/channels/channel-controls";
import { useArt, useShowPoster, type Art } from "@/screens/channels/queries";

type Props = {
  show: Show;
  isOpen: boolean;
  notice: Notice | null;
  controls: ChannelControls;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
};

/** A show's details and everything that can be done to it, for both kinds of channel. */
export function ChannelSheet({ show, isOpen, notice, controls, onClose, onCloseAutoFocus }: Props) {
  const { t } = useI18n();
  const art = useArt(show.lead.imdb_id).data ?? {};
  const poster = useShowPoster(show);
  const { lead, sources } = show;

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        closeLabel={t("common.close")}
        className="gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-xl"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <Hero url={art.backdrop || poster} />
        <div className="flex flex-col gap-4 px-4 pb-6">
          <Summary show={show} art={art} poster={poster} />
          <div>
            <NoticeLine notice={notice} />
            <div className="flex flex-wrap gap-2">
              <Button size="lg" onClick={() => controls.actions.scan(sources)}>
                <ScanLineIcon />
                {t("common.scan")}
              </Button>
              <Button size="lg" variant="outline" onClick={() => controls.actions.backfill(sources)}>
                {t("ch.backfill")}
              </Button>
            </div>
          </div>
          <SourceList show={show} controls={controls} />
          {isMovieChannel(lead) ? <CatalogSection channel={lead} /> : <EpisodesList show={show} />}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Hero({ url }: { url: string | null }) {
  const { t } = useI18n();
  const image = url ? { backgroundImage: `url(${JSON.stringify(url)})` } : undefined;

  return (
    <div className="relative h-36 shrink-0 bg-muted bg-cover bg-center" style={image}>
      <SheetClose asChild>
        <Button
          variant="secondary"
          size="icon-lg"
          className="absolute top-3 right-3 bg-background/80"
          aria-label={t("common.close")}
        >
          <XIcon />
        </Button>
      </SheetClose>
    </div>
  );
}

type SummaryProps = {
  show: Show;
  art: Art;
  poster: string | null;
};

function Summary({ show, art, poster }: SummaryProps) {
  const { t } = useI18n();
  const { lead, sources } = show;
  const title = showTitle(show);
  const ids = mappingIds(lead);
  const meta = [art.year, kindLabel(lead.kind, t), art.rating && `★ ${art.rating}`, lead.imdb_id].filter(Boolean);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end gap-3">
        <div className="-mt-10 w-24 shrink-0 overflow-hidden rounded-lg border">
          <ChannelPoster title={title} url={poster} />
        </div>
        <div className="flex min-w-0 flex-col gap-0.5 pt-3">
          <SheetTitle className="text-lg">{title}</SheetTitle>
          {lead.imdb_title && lead.topic_title && sources.length === 1 && (
            <p className="truncate text-muted-foreground">{sourceLabel(lead)}</p>
          )}
          <SheetDescription>{meta.join(" · ")}</SheetDescription>
        </div>
      </div>
      {art.overview && <p>{art.overview}</p>}
      {ids && <p className="text-muted-foreground">{t("chm.current", { title: lead.imdb_title ?? "", ids })}</p>}
      {sources.some(isWholeForum) && <p className="text-muted-foreground">{t("ch.forum_whole_hint")}</p>}
    </div>
  );
}

function SourceList({ show, controls }: { show: Show; controls: ChannelControls }) {
  const { tn } = useI18n();
  const headingId = useId();
  const { sources } = show;

  return (
    <section className="flex flex-col gap-2">
      <h3 id={headingId} className="font-medium">
        {tn("ch.source_channels", sources.length)}
      </h3>
      <ul aria-labelledby={headingId} className="flex flex-col gap-2">
        {sources.map((source) => (
          <SourceRow key={source.id} source={source} isOnlySource={sources.length === 1} controls={controls} />
        ))}
      </ul>
    </section>
  );
}
