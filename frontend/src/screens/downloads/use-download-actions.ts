import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useI18n } from "@/i18n/use-i18n";
import { api } from "@/lib/api";
import {
  bulkPauseToast,
  bulkResumeToast,
  bulkRetryToast,
  cancelToast,
  pauseToast,
  resumeToast,
  retryToast,
  useDownloadToast,
  type BulkAnswer,
  type CancelAnswer,
  type PauseAnswer,
  type ResumeAnswer,
  type RetryAnswer,
  type ToastDecision,
} from "@/lib/download-toasts";
import { DOWNLOADS_KEY, type Download } from "@/lib/downloads";

type DownloadId = Download["id"];
type DownloadIds = readonly DownloadId[];
type Action = () => Promise<ToastDecision | null>;
type BulkAction = "pause" | "resume" | "retry" | "delete";
type ToastOfBulk = (answer: BulkAnswer) => ToastDecision | null;
/** Runs once the request has succeeded; a failed one leaves things as they were. */
type OnDone = () => void;

const noToast = (): null => null;

/** The writes on download rows. Each one reports back, then refreshes the list. */
export function useDownloadActions() {
  const { errorText } = useI18n();
  const queryClient = useQueryClient();
  const showToast = useDownloadToast();

  const { mutate, isPending } = useMutation({
    mutationFn: (action: Action) => action(),
    onSuccess: (decision) => showToast(decision),
    onError: (error) => {
      toast.error(errorText(error));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: DOWNLOADS_KEY }),
  });

  const bulk = (action: BulkAction, ids: DownloadIds, toastOf: ToastOfBulk, onDone?: OnDone) =>
    mutate(() => api.post<BulkAnswer>("/api/downloads/bulk", { action, ids }).then(toastOf), {
      onSuccess: () => onDone?.(),
    });

  return {
    isPending,
    stop: (id: DownloadId) => mutate(() => api.post<CancelAnswer>(`/api/downloads/${id}/cancel`).then(cancelToast)),
    retry: (id: DownloadId) => mutate(() => api.post<RetryAnswer>(`/api/downloads/${id}/retry`).then(retryToast)),
    pause: (id: DownloadId) => mutate(() => api.post<PauseAnswer>(`/api/downloads/${id}/pause`).then(pauseToast)),
    resume: (id: DownloadId) => mutate(() => api.post<ResumeAnswer>(`/api/downloads/${id}/resume`).then(resumeToast)),
    remove: (id: DownloadId) => mutate(() => api.delete(`/api/downloads/${id}`).then(noToast)),
    pauseMany: (ids: DownloadIds, onDone?: OnDone) => bulk("pause", ids, bulkPauseToast, onDone),
    resumeMany: (ids: DownloadIds, onDone?: OnDone) => bulk("resume", ids, bulkResumeToast, onDone),
    retryMany: (ids: DownloadIds, onDone?: OnDone) => bulk("retry", ids, bulkRetryToast, onDone),
    removeMany: (ids: DownloadIds, onDone?: OnDone) => bulk("delete", ids, noToast, onDone),
  };
}
