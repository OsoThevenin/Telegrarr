import { useI18n } from "@/i18n/use-i18n";

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;
const DAYS_IN_WEEK = 7;
const NO_VALUE = "—";

type Format = {
  /** A date and time in full, for tooltips and for what is days away. */
  dateTime: (ts: number) => string;
  /** The hour and minute of a moment. */
  time: (ts: number) => string;
  /** A moment relative to now: "2m ago", "in 3h". */
  when: (ts: number | null | undefined) => string;
  /** A span of time: "2d 3h". */
  duration: (seconds: number) => string;
  /** Scan days, Monday being 0. */
  weekdays: (days: number[] | null | undefined) => string;
};

/** Everything here reads the UI language, so it lives in a hook rather than in lib/format. */
export function useFormat(): Format {
  const { t, locale } = useI18n();

  const dateTime: Format["dateTime"] = (ts) => new Date(ts * 1000).toLocaleString(locale);

  const time: Format["time"] = (ts) =>
    new Date(ts * 1000).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });

  const when: Format["when"] = (ts) => {
    if (!ts) return NO_VALUE;
    const seconds = ts - Date.now() / 1000;
    const ago = -seconds;
    if (seconds > 0) {
      if (seconds < MINUTE) return t("when.in_lt_minute");
      if (seconds < HOUR) return t("when.in_m", { n: Math.round(seconds / MINUTE) });
      if (seconds < DAY) return t("when.in_h", { n: Math.round(seconds / HOUR) });
      return dateTime(ts);
    }
    if (ago < MINUTE) return t("when.just_now");
    if (ago < HOUR) return t("when.m_ago", { n: Math.round(ago / MINUTE) });
    if (ago < DAY) return t("when.h_ago", { n: Math.round(ago / HOUR) });
    return new Date(ts * 1000).toLocaleDateString(locale);
  };

  const duration: Format["duration"] = (seconds) => {
    const d = Math.floor(seconds / DAY);
    const h = Math.floor((seconds % DAY) / HOUR);
    const m = Math.floor((seconds % HOUR) / MINUTE);
    if (d) return t("dur.dh", { d, h });
    if (h) return t("dur.hm", { h, m });
    if (m) return t("dur.m", { m });
    return t("dur.s", { s: Math.floor(seconds) });
  };

  const weekdays: Format["weekdays"] = (days) => {
    if (days?.length === DAYS_IN_WEEK) return t("common.every_day");
    if (!days?.length) return NO_VALUE;
    const names = t("common.weekdays_short").split(" ");
    return days.map((day) => names[day]).join(" ");
  };

  return { dateTime, time, when, duration, weekdays };
}
