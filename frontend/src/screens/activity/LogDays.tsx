import { useI18n } from "@/i18n/use-i18n";
import { LogRow } from "@/screens/activity/LogRow";
import { localDay, type LogDay } from "@/screens/activity/log";

const SECONDS_PER_DAY = 86400;
const OLDER_DAY: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long", year: "numeric" };

function useDayLabel(today: string) {
  const { t, locale } = useI18n();
  const yesterday = localDay(Date.now() / 1000 - SECONDS_PER_DAY);

  return (day: string) => {
    if (day === today) return t("log.today");
    if (day === yesterday) return t("log.yesterday");
    return new Date(`${day}T12:00:00`).toLocaleDateString(locale, OLDER_DAY);
  };
}

type Props = {
  days: LogDay[];
  titles: ReadonlyMap<number, string>;
};

/** The log on one card, a heading band per day. */
export function LogDays({ days, titles }: Props) {
  const today = localDay(Date.now() / 1000);
  const dayLabel = useDayLabel(today);

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      {days.map(({ day, entries }) => (
        <section key={day} aria-labelledby={`log-day-${day}`} className="border-b last:border-b-0">
          <h2
            id={`log-day-${day}`}
            className="border-b bg-muted/50 px-4 py-1.5 text-xs font-medium text-muted-foreground first-letter:uppercase"
          >
            {dayLabel(day)}
          </h2>
          <ul>
            {entries.map((entry) => (
              <LogRow
                key={entry.id}
                entry={entry}
                showsRelativeTime={day === today}
                channelTitle={entry.channelId === null ? null : (titles.get(entry.channelId) ?? null)}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
