import { useCallback } from "react";
import { toast } from "sonner";

import { useI18n } from "@/i18n/use-i18n";

type ToastParams = Record<string, string | number>;

export type ToastDecision = {
  messageKey: string;
  params?: ToastParams;
  kind: "ok" | "err";
};

export type CancelAnswer = { ok?: boolean };
export type RetryAnswer = { ok?: boolean; reason?: string | null };
export type PauseAnswer = { ok?: boolean };
export type ResumeAnswer = RetryAnswer;
export type BulkAnswer = { count?: number };

/** Stop answers `ok: false` when the row had already finished. */
export function cancelToast(answer: CancelAnswer): ToastDecision | null {
  return answer.ok === false ? { messageKey: "dl.nothing_to_cancel", kind: "err" } : null;
}

/** Retry can refuse a row, with a reason, while the request itself succeeds. */
export function retryToast(answer: RetryAnswer): ToastDecision {
  if (answer.ok) return { messageKey: "dl.requeued", kind: "ok" };
  return { messageKey: answer.reason || "dl.not_requeued", kind: "err" };
}

export function bulkRetryToast({ count = 0 }: BulkAnswer): ToastDecision {
  if (count > 0) return { messageKey: "dl.requeued_n", params: { count }, kind: "ok" };
  return { messageKey: "dl.not_requeued", kind: "err" };
}

/** Pause answers `ok: false` when the row was no longer queued or running. */
export function pauseToast(answer: PauseAnswer): ToastDecision {
  return answer.ok ? { messageKey: "dl.paused", kind: "ok" } : { messageKey: "dl.nothing_to_pause", kind: "err" };
}

/** Like Retry, Resume can refuse a row with a reason while the request itself succeeds. */
export function resumeToast(answer: ResumeAnswer): ToastDecision {
  if (answer.ok) return { messageKey: "dl.resumed", kind: "ok" };
  return { messageKey: answer.reason || "dl.not_paused", kind: "err" };
}

export function bulkPauseToast({ count = 0 }: BulkAnswer): ToastDecision {
  if (count > 0) return { messageKey: "dl.paused_n", params: { count }, kind: "ok" };
  return { messageKey: "dl.nothing_to_pause", kind: "err" };
}

export function bulkResumeToast({ count = 0 }: BulkAnswer): ToastDecision {
  if (count > 0) return { messageKey: "dl.resumed_n", params: { count }, kind: "ok" };
  return { messageKey: "dl.not_resumed", kind: "err" };
}

/** Raises what a decision above asked for; a `null` decision stays silent. */
export function useDownloadToast() {
  const { t } = useI18n();

  return useCallback(
    (decision: ToastDecision | null) => {
      if (!decision) return;
      const message = t(decision.messageKey, decision.params);
      if (decision.kind === "ok") toast.success(message);
      else toast.error(message);
    },
    [t],
  );
}
