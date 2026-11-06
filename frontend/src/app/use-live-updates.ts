import { useEffect } from "react";

import { useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";

import { DOWNLOADS_KEY, type Download } from "@/lib/downloads";
import { STATUS_KEY, type LiveSnapshot, type Stats, type Status } from "@/lib/status";

const EVENTS_URL = "/api/events";
const WATCHDOG_MS = 6000;
const STREAM_SILENT_MS = 4000;
const RECONNECT_MS = 5000;

/**
 * Lists that change when the queue does. The stream can't say what changed in them,
 * so they are fetched again when its counters move.
 */
const LIVE_LIST_KEYS: readonly QueryKey[] = [DOWNLOADS_KEY, ["channels"]];

function parseSnapshot(data: string): LiveSnapshot | null {
  try {
    const snapshot: unknown = JSON.parse(data);
    const isSnapshot = typeof snapshot === "object" && snapshot !== null && "stats" in snapshot && "active" in snapshot;
    return isSnapshot ? (snapshot as LiveSnapshot) : null;
  } catch {
    // A frame cut short by a dropped connection: the next one is a full snapshot.
    return null;
  }
}

function patchDownloads(rows: unknown, active: readonly Download[]): unknown {
  if (!Array.isArray(rows)) return rows;
  const liveRows = new Map(active.map((row) => [row.id, row]));
  return (rows as Download[]).map((row) => ({ ...row, ...liveRows.get(row.id) }));
}

function applySnapshot(queryClient: QueryClient, { active, ...live }: LiveSnapshot): void {
  queryClient.setQueryData<Status>(STATUS_KEY, (status) => status && { ...status, ...live });
  if (active.length > 0) {
    queryClient.setQueriesData({ queryKey: DOWNLOADS_KEY }, (rows) => patchDownloads(rows, active));
  }
}

function refreshLists(queryClient: QueryClient): void {
  for (const queryKey of LIVE_LIST_KEYS) void queryClient.invalidateQueries({ queryKey });
}

/** What the lists depend on. `total_size` moves with `completed`, so it adds nothing. */
function queueCounts({ channels, queued, downloading, paused, completed, failed }: Stats): string {
  return [channels, queued, downloading, paused, completed, failed].join();
}

/**
 * The app's one connection to the live stream; only the shell calls this. Screens
 * don't touch the stream: they read the query caches it keeps current.
 */
export function useLiveUpdates(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    let stream: EventSource;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let lastCounts: string | undefined;
    let lastMessageAt = Date.now();

    const onMessage = ({ data }: MessageEvent<string>) => {
      const snapshot = parseSnapshot(data);
      if (!snapshot) return;
      lastMessageAt = Date.now();
      applySnapshot(queryClient, snapshot);
      const counts = queueCounts(snapshot.stats);
      if (lastCounts !== undefined && counts !== lastCounts) refreshLists(queryClient);
      lastCounts = counts;
    };

    const connect = () => {
      stream = new EventSource(EVENTS_URL);
      stream.onmessage = onMessage;
      // The browser retries a dropped connection by itself, but gives up on an error
      // status, such as a proxy's 502 while the backend restarts.
      stream.onerror = () => {
        if (stream.readyState === EventSource.CLOSED) reconnectTimer = setTimeout(connect, RECONNECT_MS);
      };
    };

    connect();
    const watchdog = setInterval(() => {
      if (Date.now() - lastMessageAt > STREAM_SILENT_MS) refreshLists(queryClient);
    }, WATCHDOG_MS);

    return () => {
      stream.close();
      clearTimeout(reconnectTimer);
      clearInterval(watchdog);
    };
  }, [queryClient]);
}
