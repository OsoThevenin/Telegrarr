import { ClapperboardIcon, TvIcon, type LucideIcon } from "lucide-react";

import { useI18n } from "@/i18n/use-i18n";
import { cn } from "@/lib/utils";
import { isSeriesKind, kindLabel, MOVIE_KIND, type ChannelKind } from "@/screens/channels/channel";

type KindLook = { Icon: LucideIcon | null; tint: string };

/**
 * Tinted over the card, not see-through, so the label reads on any image. The text leans a fifth
 * toward the foreground, which keeps it over 4.5:1 on its own tint in both themes.
 */
const SERIES_LOOK: KindLook = {
  Icon: TvIcon,
  tint: "bg-[color-mix(in_oklch,var(--primary)_14%,var(--card))] text-[color-mix(in_oklch,var(--primary)_80%,var(--foreground))]",
};
const MOVIE_LOOK: KindLook = {
  Icon: ClapperboardIcon,
  tint: "bg-[color-mix(in_oklch,var(--warning)_16%,var(--card))] text-[color-mix(in_oklch,var(--warning)_80%,var(--foreground))]",
};
/** A kind this release does not know keeps its own name, with no icon to claim it. */
const OTHER_LOOK: KindLook = { Icon: null, tint: "bg-card text-foreground" };

const lookOf = (kind: ChannelKind) => {
  if (kind === MOVIE_KIND) return MOVIE_LOOK;
  return isSeriesKind(kind) ? SERIES_LOOK : OTHER_LOOK;
};

/** Whether a card is a series or a movie, in words: the icon only backs the label up. */
export function KindBadge({ kind }: { kind: ChannelKind }) {
  const { t } = useI18n();
  const { Icon, tint } = lookOf(kind);

  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs font-semibold whitespace-nowrap shadow-card",
        tint,
      )}
    >
      {Icon && <Icon aria-hidden="true" className="size-3.5" />}
      {kindLabel(kind, t)}
    </span>
  );
}
