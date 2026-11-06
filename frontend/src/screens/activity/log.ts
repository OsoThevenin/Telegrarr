import { queryOptions } from "@tanstack/react-query";

import { api, type ServerMessage } from "@/lib/api";

const LOG_LIMIT = 500;

type LogRow = {
  id: number;
  level: string;
  message: string;
  /** Null on entries older than keyed messages: those keep `message` as stored. */
  msg: ServerMessage | null;
  ts: number;
};

export type LogLevelFilter = "ALL" | "ERROR" | "WARN" | "INFO";

/** A run of consecutive identical rows, shown as one. */
export type LogEntry = {
  id: number;
  level: string;
  text: string;
  ts: number;
  count: number;
};

export const logQuery = queryOptions({
  queryKey: ["logs"],
  queryFn: () => api.get<LogRow[]>(`/api/logs?limit=${LOG_LIMIT}`),
});

export function collapseEntries(rows: readonly LogRow[], translate: (message: ServerMessage) => string): LogEntry[] {
  return rows.reduce<LogEntry[]>((entries, row) => {
    const text = row.msg ? translate(row.msg) : row.message;
    const last = entries.at(-1);
    if (last?.level === row.level && last.text === text) {
      return [...entries.slice(0, -1), { ...last, count: last.count + 1, ts: Math.max(last.ts, row.ts) }];
    }
    return [...entries, { id: row.id, level: row.level, text, ts: row.ts, count: 1 }];
  }, []);
}
