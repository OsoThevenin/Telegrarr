import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useI18n } from "@/i18n/use-i18n";
import { api } from "@/lib/api";
import { sourceLabel, type Channel } from "@/screens/channels/channel";
import { CHANNELS_KEY } from "@/screens/channels/queries";

type Failure = { source: Channel; error: unknown };

/** One source at a time, to go easy on Telegram; a refusal does not stop the others. */
async function forEachSource(sources: Channel[], act: (source: Channel) => Promise<unknown>) {
  let firstFailure: Failure | null = null;
  for (const source of sources) {
    try {
      await act(source);
    } catch (error) {
      firstFailure ??= { source, error };
    }
  }
  return firstFailure;
}

export type ChannelActions = ReturnType<typeof useChannelActions>;

export function useChannelActions() {
  const { t, tn, errorText } = useI18n();
  const queryClient = useQueryClient();

  /** Whether every source went through. Says so only if `doneText` is given. */
  const run = async (sources: Channel[], act: (source: Channel) => Promise<unknown>, doneText?: string) => {
    const failure = await forEachSource(sources, act);
    if (failure) {
      const reason = errorText(failure.error);
      toast.error(t("ch.source_failed", { source: sourceLabel(failure.source), reason }));
    } else if (doneText) {
      toast.success(doneText);
    }
    return !failure;
  };

  const runAndRefresh: typeof run = async (...args) => {
    const succeeded = await run(...args);
    await queryClient.invalidateQueries({ queryKey: CHANNELS_KEY });
    return succeeded;
  };

  return {
    scan: (sources: Channel[]) =>
      run(sources, ({ id }) => api.post(`/api/channels/${id}/scan`), tn("ch.scanning_sources", sources.length)),
    backfill: (sources: Channel[]) =>
      run(sources, ({ id }) => api.post(`/api/channels/${id}/backfill`), t("ch.backfill_started")),
    setEnabled: (sources: Channel[], isEnabled: boolean) =>
      runAndRefresh(sources, ({ id }) => api.patch(`/api/channels/${id}`, { enabled: isEnabled ? 1 : 0 })),
    setScanning: (source: Channel, isScanning: boolean) =>
      runAndRefresh([source], ({ id }) => api.patch(`/api/channels/${id}`, { scanning: isScanning })),
    remove: (source: Channel, doneText: string) =>
      runAndRefresh([source], ({ id }) => api.delete(`/api/channels/${id}`), doneText),
  };
}
