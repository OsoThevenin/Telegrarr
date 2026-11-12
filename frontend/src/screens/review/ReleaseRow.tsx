import { ChevronDownIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useI18n } from "@/i18n/use-i18n";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";

import { ReleasePanel } from "./ReleasePanel";
import { reasonTone } from "./reason-tone";
import { channelLabel, parsedLabel, releaseName } from "./release-text";
import { releaseKey, type PendingRelease } from "./review-api";

/** Hover is neutral; selected and open are tints of primary, so the three never look alike. */
function rowTone(isOpen: boolean, isSelected: boolean): string {
  if (isSelected) return "bg-primary/10 hover:bg-primary/15";
  if (isOpen) return "bg-primary/5 hover:bg-primary/8";
  return "hover:bg-muted/50";
}

type Props = {
  release: PendingRelease;
  isOpen: boolean;
  isSelected: boolean;
  shouldFocusSearch: boolean;
  onToggleSelected: (isSelected: boolean) => void;
  onToggleOpen: () => void;
  onResolved: (notice: string) => void;
};

export function ReleaseRow({
  release,
  isOpen,
  isSelected,
  shouldFocusSearch,
  onToggleSelected,
  onToggleOpen,
  onResolved,
}: Props) {
  const { t } = useI18n();
  const name = releaseName(release, t);
  const parsed = parsedLabel(release);
  const panelId = `review-panel-${releaseKey(release)}`;

  return (
    <li className="border-b last:border-b-0">
      <div className={cn("flex transition-colors", rowTone(isOpen, isSelected))}>
        <span className="flex pt-3.5 pl-3">
          <Checkbox
            aria-label={t("review.select", { name })}
            checked={isSelected}
            onCheckedChange={(checked) => onToggleSelected(checked === true)}
            className="after:-inset-3.5"
          />
        </span>
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={isOpen ? panelId : undefined}
          onClick={onToggleOpen}
          className="flex min-w-0 flex-1 flex-col gap-1.5 py-2.5 pr-3 pl-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset sm:flex-row sm:items-center sm:gap-4"
        >
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className={cn("text-sm font-medium", isOpen ? "wrap-anywhere" : "truncate")}>{name}</span>
            <span className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
              <span>{channelLabel(release)}</span>
              {parsed && <span>{t("review.read_as", { parsed })}</span>}
            </span>
          </span>
          <span className="flex shrink-0 items-center justify-between gap-3">
            <Badge
              variant="outline"
              className={cn(
                "h-auto min-w-0 shrink whitespace-normal sm:shrink-0 sm:whitespace-nowrap",
                reasonTone(release.reason).badge,
              )}
            >
              {t(release.reason)}
            </Badge>
            <span className="flex shrink-0 items-center gap-2">
              <span className="text-right text-xs text-muted-foreground tabular-nums sm:w-16">
                {release.size ? formatBytes(release.size) : null}
              </span>
              <ChevronDownIcon
                aria-hidden
                className={cn("size-4 text-muted-foreground transition-transform", isOpen && "rotate-180 text-primary")}
              />
            </span>
          </span>
        </button>
      </div>
      {isOpen && (
        <ReleasePanel
          id={panelId}
          release={release}
          shouldFocusSearch={shouldFocusSearch}
          onResolved={onResolved}
        />
      )}
    </li>
  );
}
