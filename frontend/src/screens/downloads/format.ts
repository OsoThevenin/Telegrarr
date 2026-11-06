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
