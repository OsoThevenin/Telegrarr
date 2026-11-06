import type { PendingRelease } from "./review-api";

type Translate = (key: string, params: { id: number }) => string;

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
