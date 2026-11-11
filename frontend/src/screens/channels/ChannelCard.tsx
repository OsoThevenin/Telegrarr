import { useRef } from "react";

import { ScanLineIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/use-i18n";
import { ChannelPoster } from "@/screens/channels/ChannelPoster";
import { KindBadge } from "@/screens/channels/KindBadge";
import { scheduleLabel, showImages, showTitle, type Show } from "@/screens/channels/channel";
import type { ChannelControls } from "@/screens/channels/channel-controls";
import { useShowPoster } from "@/screens/channels/queries";

type Props = {
  show: Show;
  controls: ChannelControls;
};

/** Opaque, so a status reads on any image. */
const STATUS_BADGE = "h-6 bg-card px-2 text-foreground shadow-card";

/** A show at a glance. Everything else it can do is in its Sheet, which the card opens. */
export function ChannelCard({ show, controls }: Props) {
  const { t, tn } = useI18n();
  const openButton = useRef<HTMLButtonElement>(null);
  const poster = useShowPoster(show);
  const title = showTitle(show);
  const { lead, sources } = show;
  const isGroup = sources.length > 1;
  const isOff = !sources.some(({ enabled }) => enabled);
  const isScanningStopped = !sources.some(({ scanning }) => scanning);
  const schedules = new Set(sources.map((source) => scheduleLabel(source, t)));
  const meta = schedules.size === 1 ? scheduleLabel(lead, t) : t("ch.schedules_vary");

  return (
    <article className="flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border border-card-border bg-card shadow-card transition-[translate,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-raised motion-reduce:transition-none motion-reduce:hover:translate-y-0">
      <button
        ref={openButton}
        type="button"
        className="relative flex flex-1 flex-col rounded-t-2xl text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
        onClick={() => controls.openShow(show, openButton.current)}
      >
        <ChannelPoster title={title} urls={showImages(show, poster)} isDimmed={isOff} />
        <span className="flex min-w-0 flex-col gap-0.5 px-3 pt-2.5">
          <span className="truncate font-medium" title={title}>
            {title}
          </span>
          <span className="truncate text-xs text-muted-foreground">{meta}</span>
        </span>
        {/* After the title in reading order, so the card's name starts with it; drawn on the image. */}
        <span className="absolute top-2 right-2 left-2 flex flex-wrap gap-1">
          <KindBadge kind={lead.kind} />
          {isGroup && <Badge className={STATUS_BADGE}>{tn("ch.sources", sources.length)}</Badge>}
          {isOff && <Badge className={STATUS_BADGE}>{t("common.disabled")}</Badge>}
          {isScanningStopped && <Badge className={STATUS_BADGE}>{t("ch.scanning_stopped")}</Badge>}
        </span>
      </button>
      <div className="p-2">
        <Button
          variant="quiet"
          size="lg"
          className="w-full"
          aria-label={t("ch.scan_of", { title })}
          onClick={() => controls.actions.scan(sources)}
        >
          <ScanLineIcon aria-hidden="true" />
          {t("common.scan")}
        </Button>
      </div>
    </article>
  );
}
