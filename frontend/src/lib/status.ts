import { queryOptions } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { Download } from "@/lib/downloads";

// The stream has no `authorized`, and says nothing when it drops: this poll covers both.
const STATUS_POLL_MS = 6000;

export type Stats = {
  channels: number;
  queued: number;
  downloading: number;
  paused: number;
  completed: number;
  failed: number;
  total_size: number;
};

export type Budget = {
  limit_gb: number;
  used_bytes: number;
  exhausted: boolean;
  resets_at: number;
};

export type Disk = {
  total: number;
  used: number;
  free: number;
};

/** One message of GET /api/events: the whole live state, not a change to it. */
export type LiveSnapshot = {
  stats: Stats;
  /** Queued and downloading rows. A transfer paused on its own is not among them. */
  active: Download[];
  /** The global queue pause; `stats.paused` counts transfers paused one by one. */
  paused: boolean;
  budget: Budget;
  disk: Disk;
  /** MB/s across every active transfer. */
  speed: number;
};

/** GET /api/status, kept current by the live stream. */
export type Status = Omit<LiveSnapshot, "active" | "speed"> & {
  authorized: boolean;
  /** Only known once the stream has spoken. */
  speed?: number;
};

export const STATUS_KEY = ["status"] as const;

export const statusQuery = queryOptions({
  queryKey: STATUS_KEY,
  queryFn: () => api.get<Status>("/api/status"),
  refetchInterval: STATUS_POLL_MS,
});
