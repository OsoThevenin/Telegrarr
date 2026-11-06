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
type BulkRetryAnswer = { count?: number };

/** Stop answers `ok: false` when the row had already finished. */
export function cancelToast(answer: CancelAnswer): ToastDecision | null {
  return answer.ok === false ? { messageKey: "dl.nothing_to_cancel", kind: "err" } : null;
}

/** Retry can refuse a row, with a reason, while the request itself succeeds. */
export function retryToast(answer: RetryAnswer): ToastDecision {
  if (answer.ok) return { messageKey: "dl.requeued", kind: "ok" };
  return { messageKey: answer.reason || "dl.not_requeued", kind: "err" };
}

export function bulkRetryToast({ count = 0 }: BulkRetryAnswer): ToastDecision {
  if (count > 0) return { messageKey: "dl.requeued_n", params: { count }, kind: "ok" };
  return { messageKey: "dl.not_requeued", kind: "err" };
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
