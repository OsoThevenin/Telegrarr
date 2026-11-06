const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"];
const BYTES_PER_UNIT = 1024;

/** How a Channel is named: its chat, plus the topic in a forum group. */
export const withTopic = (title: string, topic: string | null | undefined): string =>
  topic ? `${title} › ${topic}` : title;

/** A size for reading: "1.5 GB". */
export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return "0 B";
  const unit = Math.min(
    Math.floor(Math.log(bytes) / Math.log(BYTES_PER_UNIT)),
    BYTE_UNITS.length - 1,
  );
  const value = bytes / BYTES_PER_UNIT ** unit;
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${BYTE_UNITS[unit]}`;
}
