import { useState } from "react";

import { useQueryClient } from "@tanstack/react-query";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { StatusLine } from "@/components/StatusLine";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/i18n/use-i18n";
import { api } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { SETTINGS_KEY, type SettingsResponse } from "@/lib/settings";

// The backend's default port, for a page served without one.
const DEFAULT_PORT = "8790";
const VISIBLE_KEY_CHARS = 4;

type CopyOutcome = "copied" | "failed" | null;

type ValueRowProps = {
  label: string;
  value: string;
  copyLabel?: string;
  copyValue?: string;
};

function ValueRow({ label, value, copyLabel, copyValue }: ValueRowProps) {
  const { t } = useI18n();
  const [outcome, setOutcome] = useState<CopyOutcome>(null);

  async function handleCopy() {
    if (copyValue === undefined) return;
    setOutcome((await copyText(copyValue)) ? "copied" : "failed");
  }

  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 font-mono text-sm break-all">{value}</code>
        {copyLabel && (
          <Button type="button" variant="outline" size="sm" onClick={() => void handleCopy()}>
            {copyLabel}
          </Button>
        )}
      </div>
      {outcome === "copied" && <StatusLine tone="success">{t("common.copied")}</StatusLine>}
      {outcome === "failed" && <StatusLine tone="error">{t("common.copy_failed")}</StatusLine>}
    </div>
  );
}

export function ManualSetup({ apikey }: { apikey: string }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [isConfirming, setIsConfirming] = useState(false);
  const [wasRegenerated, setWasRegenerated] = useState(false);

  const newznabUrl = `${location.origin}/api/newznab`;
  const sabHost = `${location.hostname} : ${location.port || DEFAULT_PORT}`;

  async function handleRegenerate() {
    const result = await api.post<{ apikey: string }>("/api/integrations/arr/regenerate", {});
    queryClient.setQueryData<SettingsResponse>(
      SETTINGS_KEY,
      (current) => current && { ...current, arr: { apikey: result.apikey } },
    );
    setWasRegenerated(true);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("connect.manual_title")}</CardTitle>
        <CardDescription>{t("connect.manual_intro")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ValueRow label={t("set.newznab_url")} value={newznabUrl} copyLabel={t("set.copy_url")} copyValue={newznabUrl} />
        <ValueRow label={t("set.sab_host")} value={sabHost} />
        <ValueRow
          label={t("common.api_key")}
          value={`••••${apikey.slice(-VISIBLE_KEY_CHARS)}`}
          copyLabel={t("set.copy_key")}
          copyValue={apikey}
        />
        <div className="flex flex-col items-start gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setIsConfirming(true)}>
            {t("set.regenerate_key")}
          </Button>
          {wasRegenerated && <StatusLine tone="warning">{t("set.key_regenerated")}</StatusLine>}
        </div>
      </CardContent>
      <ConfirmDialog
        isOpen={isConfirming}
        onOpenChange={setIsConfirming}
        title={t("connect.regenerate_title")}
        description={t("connect.regenerate_body")}
        confirmLabel={t("connect.regenerate_confirm")}
        onConfirm={handleRegenerate}
        isDestructive
      />
    </Card>
  );
}
