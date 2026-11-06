import type { PendingRelease } from "./review-api";

type Translate = (key: string, params: { id: number }) => string;

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"];
const BYTES_PER_UNIT = 1024;

export function formatBytes(bytes: number | null): string {
  if (!bytes) return "";
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(BYTES_PER_UNIT)),
    BYTE_UNITS.length - 1,
  );
  return `${(bytes / BYTES_PER_UNIT ** exponent).toFixed(1)} ${BYTE_UNITS[exponent]}`;
}

export function releaseName(release: PendingRelease, t: Translate): string {
  return release.file_name ?? t("review.message", { id: release.message_id });
}

export function channelLabel(release: PendingRelease): string {
  return release.topic_title
    ? `${release.channel_title} › ${release.topic_title}`
    : release.channel_title;
}

/** How the file name was read, as `Title (year)`; null when no title came out of it. */
export function parsedLabel(release: PendingRelease): string | null {
  if (!release.parsed_title) return null;
  return release.year ? `${release.parsed_title} (${release.year})` : release.parsed_title;
}
