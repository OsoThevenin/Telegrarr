import { statusTone, type StatusTone } from "@/lib/status-tone";

/** How loudly each review reason reads: a failed lookup is an error, no match needs a choice, no year is routine. */
const REASON_TONES: Record<string, StatusTone> = {
  "review.reason.lookup_failed": "error",
  "review.reason.no_match": "warning",
  "review.reason.no_year": "neutral",
};

export function reasonTone(reason: string) {
  return statusTone(REASON_TONES[reason] ?? "neutral");
}
