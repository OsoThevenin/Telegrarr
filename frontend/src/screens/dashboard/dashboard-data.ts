import { queryOptions } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { DOWNLOADS_KEY, type Download } from "@/lib/downloads";
import type { Status } from "@/lib/status";

/** Enough rows to find the latest finishes: the API orders by id, not by finish time. */
const RECENT_SAMPLE = 20;

/** The old UI's thresholds: alarm colour is for an actual alarm, not for filling up. */
const WARNING_RATIO = 0.85;
const CRITICAL_RATIO = 0.95;

const GB = 1024 ** 3;

export type MeterTone = "normal" | "warning" | "critical";

export type DashboardState =
  | { kind: "signed_out" }
  | { kind: "budget" }
  | { kind: "paused" }
  | { kind: "disk_low" }
  | { kind: "failed" }
  | { kind: "ok" };

export const recentDownloadsQuery = queryOptions({
  queryKey: [...DOWNLOADS_KEY, { status: "completed", limit: RECENT_SAMPLE }],
  queryFn: () => api.get<Download[]>(`/api/downloads?status=completed&limit=${RECENT_SAMPLE}`),
});

export const usedRatio = (used: number, total: number): number => (total > 0 ? Math.min(used / total, 1) : 0);

export function toneOf(ratio: number): MeterTone {
  if (ratio > CRITICAL_RATIO) return "critical";
  return ratio > WARNING_RATIO ? "warning" : "normal";
}

export const budgetRatio = ({ limit_gb: limitGb, used_bytes: usedBytes }: Status["budget"]): number =>
  usedRatio(usedBytes, limitGb * GB);

/** The one thing worth saying about the install right now, worst first. */
export function dashboardState({ authorized, budget, paused, disk, stats }: Status): DashboardState {
  if (authorized === false) return { kind: "signed_out" };
  if (budget.exhausted) return { kind: "budget" };
  if (paused) return { kind: "paused" };
  if (toneOf(usedRatio(disk.used, disk.total)) === "critical") return { kind: "disk_low" };
  if (stats.failed > 0) return { kind: "failed" };
  return { kind: "ok" };
}
