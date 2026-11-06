import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useI18n } from "@/i18n/use-i18n";
import { api } from "@/lib/api";
import { STATUS_KEY, statusQuery, type Status } from "@/lib/status";

type QueuePause = {
  /** The global pause, or undefined until the backend has answered. */
  isPaused: boolean | undefined;
  isPending: boolean;
  toggle: () => void;
};

/** The global queue pause. Transfers paused one by one stay paused when it lifts. */
export function useQueuePause(): QueuePause {
  const { errorText } = useI18n();
  const queryClient = useQueryClient();
  const { data: status } = useQuery(statusQuery);
  const isPaused = status?.paused;

  const change = useMutation({
    mutationFn: () => api.post<{ paused: boolean }>(isPaused ? "/api/queue/resume" : "/api/queue/pause"),
    onSuccess: ({ paused }) => {
      queryClient.setQueryData<Status>(STATUS_KEY, (current) => current && { ...current, paused });
    },
    onError: (error) => toast.error(errorText(error)),
  });

  return { isPaused, isPending: change.isPending, toggle: () => change.mutate() };
}
