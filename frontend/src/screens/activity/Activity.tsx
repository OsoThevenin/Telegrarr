import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { LoadError } from "@/components/LoadError";
import { LoadingBlock } from "@/components/LoadingBlock";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/use-i18n";
import { LogDays } from "@/screens/activity/LogDays";
import { LogToolbar } from "@/screens/activity/LogToolbar";
import { collapseEntries, groupByDay, LOG_LIMIT, logQuery } from "@/screens/activity/log";
import { applyLogFilters, isFiltering, NO_LOG_FILTERS, type LogFilters } from "@/screens/activity/log-filters";
import { sourceLabel } from "@/screens/channels/channel";
import { useChannels } from "@/screens/channels/queries";

function NoMatches({ onClear }: { onClear: () => void }) {
  const { t } = useI18n();

  return (
    <div className="flex flex-col items-start gap-2">
      <p className="text-muted-foreground">{t("log.none")}</p>
      <Button variant="outline" className="h-11 sm:h-9" onClick={onClear}>
        {t("log.clear_filters")}
      </Button>
    </div>
  );
}

/** Channel names by id, as the Channels screen names them; empty until the list arrives. */
function useChannelTitles(): ReadonlyMap<number, string> {
  const channels = useChannels();
  return new Map((channels.data ?? []).map((channel) => [channel.id, sourceLabel(channel)]));
}

export function Activity() {
  const { t, msg } = useI18n();
  const [filters, setFilters] = useState<LogFilters>(NO_LOG_FILTERS);
  const log = useQuery(logQuery);
  const titles = useChannelTitles();

  const allEntries = collapseEntries(log.data ?? [], msg);
  const entries = applyLogFilters(allEntries, filters);
  const hasEntries = allEntries.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <LogToolbar
        entries={allEntries}
        filters={filters}
        onChange={setFilters}
        titles={titles}
        isRefreshing={log.isFetching}
        onRefresh={() => void log.refetch()}
      />

      {log.isSuccess && hasEntries && isFiltering(filters) && (
        <p className="text-sm text-muted-foreground tabular-nums">
          {t("log.shown_of", { shown: entries.length, total: allEntries.length })}
        </p>
      )}
      {log.isPending && <LoadingBlock rows={8} />}
      {log.isError && <LoadError error={log.error} onRetry={() => void log.refetch()} />}
      {log.isSuccess && !hasEntries && <p className="text-muted-foreground">{t("log.empty")}</p>}
      {log.isSuccess && hasEntries && entries.length === 0 && <NoMatches onClear={() => setFilters(NO_LOG_FILTERS)} />}
      {log.isSuccess && entries.length > 0 && <LogDays days={groupByDay(entries)} titles={titles} />}
      {log.isSuccess && log.data.length >= LOG_LIMIT && (
        <p className="text-center text-sm text-muted-foreground">{t("log.limit_reached", { n: LOG_LIMIT })}</p>
      )}
    </div>
  );
}
