import { queryOptions } from "@tanstack/react-query";

import { api, type ServerMessage } from "@/lib/api";
import type { StatusTone } from "@/lib/status-tone";

/** How many of the newest rows the screen asks for. */
export const LOG_LIMIT = 500;
/** How often the open screen reads the log again; TanStack pauses this in background tabs. */
export const LOG_REFRESH_MS = 10_000;

type LogRow = {
  id: number;
  /** Null for what concerns no single channel, such as pausing downloads. */
  channel_id: number | null;
  level: string;
  message: string;
  /** Null on entries older than keyed messages: those keep `message` as stored. */
  msg: ServerMessage | null;
  ts: number;
};

/** A run of consecutive identical rows, shown as one. */
export type LogEntry = {
  id: number;
  channelId: number | null;
  level: string;
  text: string;
  ts: number;
  count: number;
};

/** Entries that share a calendar day, newest day first as the log comes. */
export type LogDay = { day: string; entries: LogEntry[] };

const LEVEL_TONES: Record<string, StatusTone> = { ERROR: "error", WARN: "warning" };

const LEVEL_LABEL_KEYS: Record<string, string> = {
  ERROR: "log.level_error",
  WARN: "log.level_warn",
  INFO: "log.level_info",
};

/** Errors read red, warnings amber, everything else stays quiet. */
export function levelTone(level: string): StatusTone {
  return LEVEL_TONES[level] ?? "neutral";
}

/** The i18n key naming a level, or null for a level this UI does not know. */
export function levelLabelKey(level: string): string | null {
  return LEVEL_LABEL_KEYS[level] ?? null;
}

/** The local calendar day of a moment, as YYYY-MM-DD. */
export function localDay(ts: number): string {
  const date = new Date(ts * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function groupByDay(entries: readonly LogEntry[]): LogDay[] {
  return entries.reduce<LogDay[]>((days, entry) => {
    const day = localDay(entry.ts);
    const last = days.at(-1);
    if (last?.day === day) {
      return [...days.slice(0, -1), { day, entries: [...last.entries, entry] }];
    }
    return [...days, { day, entries: [entry] }];
  }, []);
}

export const logQuery = queryOptions({
  queryKey: ["logs"],
  queryFn: () => api.get<LogRow[]>(`/api/logs?limit=${LOG_LIMIT}`),
  refetchInterval: LOG_REFRESH_MS,
});

export function collapseEntries(rows: readonly LogRow[], translate: (message: ServerMessage) => string): LogEntry[] {
  return rows.reduce<LogEntry[]>((entries, row) => {
    const text = row.msg ? translate(row.msg) : row.message;
    const last = entries.at(-1);
    if (last?.level === row.level && last.text === text && last.channelId === row.channel_id) {
      return [...entries.slice(0, -1), { ...last, count: last.count + 1, ts: Math.max(last.ts, row.ts) }];
    }
    return [...entries, { id: row.id, channelId: row.channel_id, level: row.level, text, ts: row.ts, count: 1 }];
  }, []);
}
