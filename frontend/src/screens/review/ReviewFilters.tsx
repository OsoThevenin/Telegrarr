import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n/use-i18n";
import { cn } from "@/lib/utils";

import { applyFilters, channelFacets, reasonFacets, type Filters } from "./filters";
import { reasonTone } from "./reason-tone";
import type { PendingRelease } from "./review-api";

type Props = {
  releases: PendingRelease[];
  filters: Filters;
  onChange: (filters: Filters) => void;
};

type ReasonChipProps = {
  label: string;
  count: number;
  isPressed: boolean;
  dot?: string;
  onClick: () => void;
};

function ReasonChip({ label, count, isPressed, dot, onClick }: ReasonChipProps) {
  return (
    <button
      type="button"
      aria-pressed={isPressed}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors outline-none sm:min-h-8 focus-visible:ring-3 focus-visible:ring-ring/50",
        isPressed ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted",
      )}
    >
      {dot && <span aria-hidden className={cn("size-2 rounded-full", dot, isPressed && "ring-2 ring-primary-foreground/70")} />}
      {label} <span className="tabular-nums">{count}</span>
    </button>
  );
}

export function ReviewFilters({ releases, filters, onChange }: Props) {
  const { t } = useI18n();
  const channels = channelFacets(releases, filters);
  const reasons = reasonFacets(releases, filters);
  const countWithoutChannel = applyFilters(releases, { ...filters, channelId: null }).length;
  const countWithoutReason = applyFilters(releases, { ...filters, reason: null }).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          type="search"
          aria-label={t("review.search_label")}
          placeholder={t("review.search_hint")}
          value={filters.query}
          onChange={(event) => onChange({ ...filters, query: event.target.value })}
          className="h-11 sm:h-9 sm:flex-1"
        />
        <select
          aria-label={t("review.filter_channel")}
          value={filters.channelId ?? ""}
          onChange={({ target }) =>
            onChange({ ...filters, channelId: target.value === "" ? null : Number(target.value) })
          }
          className="h-11 min-w-0 rounded-lg border border-input bg-card px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:h-9 sm:max-w-64 dark:bg-input/30"
        >
          <option value="">{`${t("review.all_channels")} (${countWithoutChannel})`}</option>
          {channels.map(({ channelId, title, count }) => (
            <option key={channelId} value={channelId}>{`${title} (${count})`}</option>
          ))}
        </select>
      </div>
      <div role="group" aria-label={t("review.filter_reason")} className="flex flex-wrap gap-1.5">
        <ReasonChip
          label={t("review.all_reasons")}
          count={countWithoutReason}
          isPressed={filters.reason === null}
          onClick={() => onChange({ ...filters, reason: null })}
        />
        {reasons.map(({ reason, count }) => (
          <ReasonChip
            key={reason}
            label={t(reason)}
            count={count}
            isPressed={filters.reason === reason}
            dot={reasonTone(reason).dot}
            onClick={() => onChange({ ...filters, reason })}
          />
        ))}
      </div>
    </div>
  );
}
