import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useI18n } from "@/i18n/use-i18n";
import { api } from "@/lib/api";
import {
  cancelToast,
  retryToast,
  useDownloadToast,
  type CancelAnswer,
  type RetryAnswer,
  type ToastDecision,
} from "@/lib/download-toasts";
import { DOWNLOADS_KEY, type Download } from "@/lib/downloads";

type DownloadId = Download["id"];
type Action = () => Promise<ToastDecision | null>;

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

  return {
    isPending,
    stop: (id: DownloadId) => mutate(() => api.post<CancelAnswer>(`/api/downloads/${id}/cancel`).then(cancelToast)),
    retry: (id: DownloadId) => mutate(() => api.post<RetryAnswer>(`/api/downloads/${id}/retry`).then(retryToast)),
    remove: (id: DownloadId) => mutate(() => api.delete(`/api/downloads/${id}`).then(noToast)),
    removeMany: (ids: readonly DownloadId[]) =>
      mutate(() => api.post("/api/downloads/bulk", { action: "delete", ids }).then(noToast)),
  };
}
