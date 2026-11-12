import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/i18n/use-i18n";
import { statusTone } from "@/lib/status-tone";
import { useFormat } from "@/lib/use-format";
import { cn } from "@/lib/utils";
import { levelLabelKey, levelTone, type LogEntry } from "@/screens/activity/log";

const CLOCK: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" };

function LevelBadge({ level }: { level: string }) {
  const { t } = useI18n();
  const labelKey = levelLabelKey(level);

  return (
    <Badge variant="outline" className={statusTone(levelTone(level)).badge}>
      {labelKey ? t(labelKey) : level}
    </Badge>
  );
}

function RepeatCount({ count }: { count: number }) {
  const { t } = useI18n();
  const label = t("log.times", { n: count });

  return (
    <span className="font-medium text-foreground tabular-nums" title={label}>
      <span aria-hidden>×{count}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

type Props = {
  entry: LogEntry;
  /** The channel the entry came from; null when it concerns none, or the channel is gone. */
  channelTitle: string | null;
  /** Off for past days, whose heading already says when. */
  showsRelativeTime: boolean;
};

/**
 * One entry on a shared grid, so times, levels and messages line up down the card.
 * On phones the message drops to a second line under the time and level.
 */
export function LogRow({ entry, channelTitle, showsRelativeTime }: Props) {
  const { locale } = useI18n();
  const { dateTime, when } = useFormat();
  const tone = levelTone(entry.level);
  const moment = new Date(entry.ts * 1000);

  return (
    <li
      data-tone={tone}
      className={cn(
        "grid grid-cols-[auto_auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1 border-b px-4 py-2 text-sm last:border-b-0",
        "sm:grid-cols-[4.25rem_4.5rem_minmax(0,1fr)_auto]",
        statusTone(tone).row,
      )}
    >
      <time dateTime={moment.toISOString()} title={dateTime(entry.ts)} className="tabular-nums">
        {moment.toLocaleTimeString(locale, CLOCK)}
      </time>
      <LevelBadge level={entry.level} />
      <div className="col-span-full order-last min-w-0 sm:order-none sm:col-span-1">
        <p className="break-words">{entry.text}</p>
        {channelTitle && <p className="truncate text-xs text-muted-foreground">{channelTitle}</p>}
      </div>
      <span className="flex items-baseline justify-end gap-2 text-xs text-muted-foreground">
        {entry.count > 1 && <RepeatCount count={entry.count} />}
        {showsRelativeTime && <span className="whitespace-nowrap">{when(entry.ts)}</span>}
      </span>
    </li>
  );
}
