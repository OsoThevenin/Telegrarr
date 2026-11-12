import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/i18n/use-i18n";
import { cn } from "@/lib/utils";
import {
  ALL_LEVELS,
  applyLogFilters,
  logChannelFacets,
  type LogFilters,
  type LogLevelFilter,
} from "@/screens/activity/log-filters";
import type { LogEntry } from "@/screens/activity/log";

/** Touch-sized on phones, desktop-sized from `sm`; the trigger's own size attribute needs overriding too. */
const CONTROL_HEIGHT = "h-11 data-[size=default]:h-11 sm:h-9 sm:data-[size=default]:h-9";
/** Radix Select needs a non-empty value for "no channel filter". */
const ALL_CHANNELS = "all";

const LEVEL_OPTIONS: readonly { value: LogLevelFilter; labelKey: string }[] = [
  { value: ALL_LEVELS, labelKey: "log.all_levels" },
  { value: "ERROR", labelKey: "log.errors" },
  { value: "WARN", labelKey: "log.warnings" },
  { value: "INFO", labelKey: "log.info" },
];

type FilterProps = {
  entries: readonly LogEntry[];
  filters: LogFilters;
  onChange: (filters: LogFilters) => void;
};

function LevelSelect({ filters, onChange }: Omit<FilterProps, "entries">) {
  const { t } = useI18n();

  return (
    <Select value={filters.level} onValueChange={(level) => onChange({ ...filters, level: level as LogLevelFilter })}>
      <SelectTrigger aria-label={t("log.level")} className={cn("min-w-0 flex-1 sm:flex-none", CONTROL_HEIGHT)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {LEVEL_OPTIONS.map(({ value, labelKey }) => (
          <SelectItem key={value} value={value}>
            {t(labelKey)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ChannelSelect({ entries, filters, onChange, titles }: FilterProps & { titles: ReadonlyMap<number, string> }) {
  const { t } = useI18n();
  const facets = logChannelFacets(entries, filters, titles);
  if (facets.length === 0) return null;
  const countWithoutChannel = applyLogFilters(entries, { ...filters, channelId: null }).length;

  return (
    <Select
      value={filters.channelId === null ? ALL_CHANNELS : String(filters.channelId)}
      onValueChange={(value) => onChange({ ...filters, channelId: value === ALL_CHANNELS ? null : Number(value) })}
    >
      <SelectTrigger aria-label={t("log.channel")} className={cn("min-w-0 flex-1 sm:max-w-64 sm:flex-none", CONTROL_HEIGHT)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_CHANNELS}>{`${t("log.all_channels")} (${countWithoutChannel})`}</SelectItem>
        {facets.map(({ channelId, title, count }) => (
          <SelectItem key={channelId} value={String(channelId)}>{`${title} (${count})`}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

type Props = FilterProps & {
  titles: ReadonlyMap<number, string>;
  isRefreshing: boolean;
  onRefresh: () => void;
};

export function LogToolbar({ entries, filters, onChange, titles, isRefreshing, onRefresh }: Props) {
  const { t } = useI18n();

  return (
    // Phones: search and Actualitza share the first line, the two filters the second.
    <div className="flex flex-wrap gap-2 sm:flex-nowrap sm:items-center">
      <Input
        type="search"
        className="h-11 min-w-0 flex-1 basis-40 sm:h-9"
        placeholder={t("log.search")}
        aria-label={t("log.search")}
        value={filters.query}
        onChange={(event) => onChange({ ...filters, query: event.target.value })}
      />
      <div className="order-last flex w-full gap-2 sm:order-none sm:w-auto">
        <LevelSelect filters={filters} onChange={onChange} />
        <ChannelSelect entries={entries} filters={filters} onChange={onChange} titles={titles} />
      </div>
      <Button variant="outline" className="h-11 shrink-0 sm:h-9" disabled={isRefreshing} onClick={onRefresh}>
        {t("common.refresh")}
      </Button>
    </div>
  );
}
