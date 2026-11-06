import { useEffect, useState } from "react";

import { useQueryClient } from "@tanstack/react-query";

import { useI18n } from "@/i18n/use-i18n";
import { api } from "@/lib/api";
import { sourceLabel, type Channel } from "@/screens/channels/channel";
import { CHANNELS_KEY } from "@/screens/channels/queries";

const NOTICE_MS = 5000;

export type Notice = { tone: "ok" | "error"; text: string };
export type Notify = (notice: Notice | null) => void;

/** The outcome of the last action. A success fades; a failure stays until the next action. */
export function useNotice(): [Notice | null, Notify] {
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    if (notice?.tone !== "ok") return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  return [notice, setNotice];
}

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

export function useChannelActions(notify: Notify) {
  const { t, tn, errorText } = useI18n();
  const queryClient = useQueryClient();

  /** Whether every source went through. Says so only if `doneText` is given. */
  const run = async (sources: Channel[], act: (source: Channel) => Promise<unknown>, doneText?: string) => {
    notify(null);
    const failure = await forEachSource(sources, act);
    if (failure) {
      const reason = errorText(failure.error);
      notify({ tone: "error", text: t("ch.source_failed", { source: sourceLabel(failure.source), reason }) });
    } else if (doneText) {
      notify({ tone: "ok", text: doneText });
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
    remove: (source: Channel, doneText: string) =>
      runAndRefresh([source], ({ id }) => api.delete(`/api/channels/${id}`), doneText),
  };
}
