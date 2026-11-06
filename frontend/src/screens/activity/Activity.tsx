import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { LoadError } from "@/components/LoadError";
import { LoadingBlock } from "@/components/LoadingBlock";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/i18n/use-i18n";
import { useFormat } from "@/lib/use-format";
import { collapseEntries, logQuery, type LogEntry, type LogLevelFilter } from "@/screens/activity/log";

const ALL_LEVELS: LogLevelFilter = "ALL";

const LEVEL_OPTIONS: readonly { value: LogLevelFilter; labelKey: string }[] = [
  { value: ALL_LEVELS, labelKey: "log.all_levels" },
  { value: "ERROR", labelKey: "log.errors" },
  { value: "WARN", labelKey: "log.warnings" },
  { value: "INFO", labelKey: "log.info" },
];

function LogRow({ entry }: { entry: LogEntry }) {
  const { t } = useI18n();
  const { dateTime, when } = useFormat();

  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b py-2 text-sm last:border-b-0">
      <Badge variant={entry.level === "ERROR" ? "destructive" : "secondary"} className="font-mono">
        {entry.level}
      </Badge>
      <span className="min-w-0 flex-1 basis-48 break-words">{entry.text}</span>
      {entry.count > 1 && <span title={t("log.times", { n: entry.count })}>×{entry.count}</span>}
      <time className="text-muted-foreground tabular-nums" title={dateTime(entry.ts)}>
        {when(entry.ts)}
      </time>
    </li>
  );
}

export function Activity() {
  const { t, msg } = useI18n();
  const [level, setLevel] = useState<LogLevelFilter>(ALL_LEVELS);
  const [search, setSearch] = useState("");
  const log = useQuery(logQuery);

  const needle = search.trim().toLowerCase();
  const entries = collapseEntries(log.data ?? [], msg).filter(
    (entry) =>
      (level === ALL_LEVELS || entry.level === level) &&
      (!needle || entry.text.toLowerCase().includes(needle)),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          className="min-w-0 flex-1 basis-48"
          placeholder={t("log.search")}
          aria-label={t("log.search")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Select value={level} onValueChange={(next) => setLevel(next as LogLevelFilter)}>
          <SelectTrigger aria-label={t("log.level")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LEVEL_OPTIONS.map(({ value, labelKey }) => (
              <SelectItem key={value} value={value}>
                {t(labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" disabled={log.isFetching} onClick={() => void log.refetch()}>
          {t("common.refresh")}
        </Button>
      </div>

      {log.isPending && <LoadingBlock rows={8} />}
      {log.isError && <LoadError error={log.error} onRetry={() => void log.refetch()} />}
      {log.isSuccess && entries.length === 0 && <p className="text-muted-foreground">{t("log.none")}</p>}
      {log.isSuccess && entries.length > 0 && (
        <ul>
          {entries.map((entry) => (
            <LogRow key={entry.id} entry={entry} />
          ))}
        </ul>
      )}
    </div>
  );
}
