import { useQuery } from "@tanstack/react-query";
import { ArrowUpCircle, CheckIcon, ExternalLink } from "lucide-react";

import { LoadError } from "@/components/LoadError";
import { LoadingBlock } from "@/components/LoadingBlock";
import { ToneBadge } from "@/components/ToneBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/i18n/use-i18n";
import { SMALL_BUTTON } from "@/lib/touch";
import { InfoGrid } from "@/screens/system/InfoGrid";
import { updatesQuery } from "@/screens/system/system-api";

export function UpdatesPanel() {
  const { t, msg } = useI18n();
  const updates = useQuery(updatesQuery);

  if (updates.isPending) return <LoadingBlock rows={2} />;
  if (updates.isError) return <LoadError error={updates.error} onRetry={() => void updates.refetch()} />;

  const { current, latest, up_to_date: isUpToDate, url, error } = updates.data;
  const latestLabel = latest ? `v${latest}` : msg(error) || t("common.unknown");
  const upToDateText = latest ? t("updates.latest") : t("updates.none_newer");

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t("sys.tab.updates")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <InfoGrid
          rows={[
            [t("updates.installed"), `v${current}`],
            [t("updates.latest_label"), latestLabel],
          ]}
        />
        <div className="flex flex-wrap items-center gap-3">
          {isUpToDate ? (
            <ToneBadge tone="success">
              <CheckIcon data-icon="inline-start" aria-hidden="true" />
              {upToDateText}
            </ToneBadge>
          ) : (
            <Badge variant="outline" className="border-primary/25 bg-primary/10 text-primary">
              <ArrowUpCircle data-icon="inline-start" aria-hidden="true" />
              {t("updates.available", { version: latest })}
            </Badge>
          )}
          <Button asChild variant="ghost" size="sm" className={SMALL_BUTTON}>
            <a href={url} target="_blank" rel="noopener noreferrer">
              {t("updates.release_notes")}{" "}
              <span className="sr-only">{t("common.new_tab")}</span>
              <ExternalLink data-icon="inline-end" aria-hidden="true" />
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
