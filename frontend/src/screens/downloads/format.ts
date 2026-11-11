import type { Download } from "@/lib/downloads";

const BYTES_PER_GB = 1e9;
const BYTES_PER_MB = 1024 * 1024;
const SECONDS_PER_MINUTE = 60;

export const formatSize = (bytes: number): string => `${(bytes / BYTES_PER_GB).toFixed(2)} GB`;

export const percent = ({ progress }: Download): number => Math.round(progress * 100);

type Remaining = { m: number; s: number };

/** The time a running transfer has left, or null when it can't be told. */
export function timeRemaining({ status, speed_mbs, file_size, progress }: Download): Remaining | null {
  if (status !== "downloading" || !speed_mbs || !file_size) return null;
  const seconds = (file_size * (1 - progress)) / (speed_mbs * BYTES_PER_MB);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return { m: Math.floor(seconds / SECONDS_PER_MINUTE), s: Math.floor(seconds % SECONDS_PER_MINUTE) };
}

/** The largest unit first; each holds this many seconds. */
const RELATIVE_UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", SECONDS_PER_MINUTE],
  ["second", 1],
];

/** "fa 2 h", "2 hr. ago": how long ago a moment was, in the largest unit that fits. */
export function relativeTime(epochSeconds: number, locale: string, nowMs: number = Date.now()): string {
  const elapsed = Math.max(0, nowMs / 1000 - epochSeconds);
  const [unit, size] = RELATIVE_UNITS.find(([, seconds]) => elapsed >= seconds) ?? RELATIVE_UNITS[RELATIVE_UNITS.length - 1];
  return new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" }).format(-Math.floor(elapsed / size), unit);
}

/** The whole date and time, for the tooltip of a relative one. */
export const fullDateTime = (epochSeconds: number, locale: string): string =>
  new Date(epochSeconds * 1000).toLocaleString(locale, { dateStyle: "long", timeStyle: "short" });
