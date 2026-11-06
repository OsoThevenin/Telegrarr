import { useRef } from "react";

import { ScanLineIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/use-i18n";
import { ChannelMenu } from "@/screens/channels/ChannelMenu";
import { ChannelPoster } from "@/screens/channels/ChannelPoster";
import { kindLabel, scheduleLabel, showTitle, type Show } from "@/screens/channels/channel";
import type { ChannelControls } from "@/screens/channels/channel-controls";
import { useShowPoster } from "@/screens/channels/queries";

type Props = {
  show: Show;
  controls: ChannelControls;
};

export function ChannelCard({ show, controls }: Props) {
  const { t, tn } = useI18n();
  const openButton = useRef<HTMLButtonElement>(null);
  const poster = useShowPoster(show);
  const title = showTitle(show);
  const { lead, sources } = show;
  const isGroup = sources.length > 1;
  const isOff = !sources.some(({ enabled }) => enabled);
  const meta = isGroup ? kindLabel(lead.kind, t) : `${kindLabel(lead.kind, t)} · ${scheduleLabel(lead, t)}`;

  return (
    <article className="flex h-full min-w-0 flex-col overflow-hidden rounded-xl border bg-card transition-colors hover:bg-muted/50">
      <button
        ref={openButton}
        type="button"
        className="flex flex-1 flex-col text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
        onClick={() => controls.openShow(show, openButton.current)}
      >
        <ChannelPoster title={title} url={poster}>
          {/* The slot for #70's scanning-stopped badge. */}
          <span className="absolute top-2 left-2 flex flex-wrap gap-1">
            {isGroup && <Badge variant="secondary">{tn("ch.sources", sources.length)}</Badge>}
            {isOff && <Badge variant="secondary">{t("common.disabled")}</Badge>}
          </span>
        </ChannelPoster>
        <span className="flex min-w-0 flex-col gap-0.5 px-3 pt-2">
          <span className="truncate font-medium" title={title}>
            {title}
          </span>
          <span className="truncate text-xs text-muted-foreground">{meta}</span>
        </span>
      </button>
      <div className="flex items-center gap-1 p-2">
        <Button
          variant="ghost"
          size="lg"
          className="flex-1"
          aria-label={t("ch.scan_of", { title })}
          onClick={() => controls.actions.scan(sources)}
        >
          <ScanLineIcon />
          {t("common.scan")}
        </Button>
        <ChannelMenu show={show} controls={controls} />
      </div>
    </article>
  );
}
