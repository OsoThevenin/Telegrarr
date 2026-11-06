import { queryOptions } from "@tanstack/react-query";

import { api, type ServerMessage } from "@/lib/api";

export type HealthCheck = {
  id: string;
  ok: boolean;
  level: string;
  message: ServerMessage;
};

export type SystemStatus = {
  version: string;
  python: string;
  platform: string;
  uptime_seconds: number;
  channels: number;
  channels_enabled: number;
  workers: number;
  max_concurrent: number;
  db_size: number;
  disk: { free: number; total: number };
  data_dir: string;
  health: HealthCheck[];
};

export type ScanTask = {
  title: string;
  poll_minutes: number;
  weekdays: number[];
  enabled: boolean;
  last_run: number | null;
  /** Null while the task is disabled or scanning is off. */
  next_run: number | null;
  channel_id: number;
};

export type Backup = {
  name: string;
  size: number;
  created: number;
};

type Updates = {
  current: string;
  latest: string | null;
  up_to_date: boolean;
  url: string;
  error: ServerMessage | null;
};

export const systemStatusQuery = queryOptions({
  queryKey: ["system", "status"],
  queryFn: () => api.get<SystemStatus>("/api/system/status"),
});

export const scanTasksQuery = queryOptions({
  queryKey: ["system", "tasks"],
  queryFn: () => api.get<ScanTask[]>("/api/system/tasks"),
});

export const backupsQuery = queryOptions({
  queryKey: ["system", "backups"],
  queryFn: () => api.get<Backup[]>("/api/system/backups"),
});

export const updatesQuery = queryOptions({
  queryKey: ["system", "updates"],
  queryFn: () => api.get<Updates>("/api/system/updates"),
});

export const backupPath = (name: string): string => `/api/system/backups/${encodeURIComponent(name)}`;
