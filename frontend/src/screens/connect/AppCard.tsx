import { useState, type FormEvent } from "react";

import { useQueryClient } from "@tanstack/react-query";

import { SaveOutcomeLine } from "@/components/SaveOutcomeLine";
import { SecretField, secretPatch, secretState } from "@/components/SecretField";
import { StatusLine } from "@/components/StatusLine";
import { TextField } from "@/components/TextField";
import { ToneBadge } from "@/components/ToneBadge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/i18n/use-i18n";
import { isEnvLocked, useSaveSettings, useSettingsForm, type ArrApp, type Settings } from "@/lib/settings";
import type { StatusTone } from "@/lib/status-tone";
import { RADARR_DEFAULTS_KEY, useAppStatus } from "@/screens/connect/connect-api";

type AppDetails = {
  name: string;
  port: number;
  roleKey: string;
  /** Set for an app whose pages Telegrarr links to from the operator's browser. */
  externalUrlKey?: "sonarr_external_url" | "radarr_external_url";
};

const APP_DETAILS: Record<ArrApp, AppDetails> = {
  prowlarr: { name: "Prowlarr", port: 9696, roleKey: "connect.role.prowlarr" },
  sonarr: { name: "Sonarr", port: 8989, roleKey: "connect.role.sonarr", externalUrlKey: "sonarr_external_url" },
  radarr: { name: "Radarr", port: 7878, roleKey: "connect.role.radarr", externalUrlKey: "radarr_external_url" },
};

export function appName(app: ArrApp): string {
  return APP_DETAILS[app].name;
}

type UrlKey = `${ArrApp}_url` | NonNullable<AppDetails["externalUrlKey"]>;
type AppStatus = ReturnType<typeof useAppStatus>;

type Translate = ReturnType<typeof useI18n>["t"];

type StatusProps = {
  isSetUp: boolean;
  status: AppStatus;
};

type BadgeState = {
  tone: StatusTone;
  label: string;
};

function badgeState({ isSetUp, status }: StatusProps, t: Translate): BadgeState {
  if (!isSetUp) return { tone: "neutral", label: t("set.status.not_configured") };
  if (status.isFetching) return { tone: "neutral", label: t("common.testing") };
  if (status.data?.ok) {
    return { tone: "success", label: t("connect.connected_version", { version: status.data.version }) };
  }
  return { tone: "error", label: t("connect.status_error") };
}

function StatusBadge(props: StatusProps) {
  const { t } = useI18n();
  const { tone, label } = badgeState(props, t);

  return <ToneBadge tone={tone}>{label}</ToneBadge>;
}

function StatusError({ isSetUp, status }: StatusProps) {
  const { msg, errorText } = useI18n();
  if (!isSetUp || status.isFetching) return null;
  if (status.isError) return <StatusLine tone="error">{errorText(status.error)}</StatusLine>;
  if (status.data && !status.data.ok) return <StatusLine tone="error">{msg(status.data.error)}</StatusLine>;
  return null;
}

type FieldsProps = {
  app: ArrApp;
  settings: Settings;
  form: Record<UrlKey, string>;
  onFieldChange: (key: UrlKey, value: string) => void;
  draft: string | null;
  onDraftChange: (draft: string | null) => void;
  onClearKey: () => Promise<void>;
};

function AppFields({ app, settings, form, onFieldChange, draft, onDraftChange, onClearKey }: FieldsProps) {
  const { t } = useI18n();
  const urlKey = `${app}_url` as const;
  const { port, externalUrlKey } = APP_DETAILS[app];

  return (
    <div className="flex w-full max-w-md flex-col gap-3">
      <TextField
        label={t("common.url")}
        hint={t("connect.url_hint")}
        type="url"
        placeholder={`http://${app}:${port}`}
        className="font-mono"
        isEnvLocked={isEnvLocked(settings, urlKey)}
        value={form[urlKey]}
        onChange={(event) => onFieldChange(urlKey, event.target.value)}
      />
      <SecretField
        label={t("common.api_key")}
        hint={t("connect.key_placeholder")}
        state={secretState(settings, `${app}_key`, settings[`${app}_key_set`])}
        draft={draft}
        onDraftChange={onDraftChange}
        onClear={onClearKey}
      />
      {externalUrlKey && (
        <TextField
          label={t("connect.external_url")}
          hint={t("connect.external_url_hint")}
          type="url"
          placeholder={`https://${app}.example.com`}
          className="font-mono"
          value={form[externalUrlKey]}
          onChange={(event) => onFieldChange(externalUrlKey, event.target.value)}
        />
      )}
    </div>
  );
}

type Props = {
  app: ArrApp;
  settings: Settings;
};

export function AppCard({ app, settings }: Props) {
  const { t } = useI18n();
  const urlKey = `${app}_url` as const;
  const secretKey = `${app}_key`;
  const { name, roleKey, externalUrlKey } = APP_DETAILS[app];
  const { form, setField, isSaving, outcome, submit } = useSettingsForm(
    settings,
    externalUrlKey ? [urlKey, externalUrlKey] : [urlKey],
  );
  const save = useSaveSettings();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<string | null>(null);

  const isSetUp = Boolean(settings[urlKey]) && settings[`${app}_key_set`];
  const status = useAppStatus(app, isSetUp);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!(await submit(secretPatch(secretKey, draft)))) return;
    setDraft(null);
    await status.refetch();
    await queryClient.invalidateQueries({ queryKey: RADARR_DEFAULTS_KEY });
  }

  async function handleClear() {
    await save.mutateAsync({ [secretKey]: "" });
    setDraft(null);
  }

  return (
    <Card role="group" aria-label={name}>
      <CardHeader>
        <CardTitle>{name}</CardTitle>
        <CardDescription>{t(roleKey)}</CardDescription>
        <CardAction>
          <StatusBadge isSetUp={isSetUp} status={status} />
        </CardAction>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col items-start gap-3" onSubmit={(event) => void handleSubmit(event)}>
          <AppFields
            app={app}
            settings={settings}
            form={form}
            onFieldChange={setField}
            draft={draft}
            onDraftChange={setDraft}
            onClearKey={handleClear}
          />
          <Button type="submit" size="sm" className="h-11 sm:h-7" disabled={isSaving || status.isFetching}>
            {t("common.save_test")}
          </Button>
          {(outcome.kind !== "saved" || !isSetUp) && (
            <SaveOutcomeLine outcome={outcome} savedText={t("connect.saved_incomplete")} />
          )}
          <StatusError isSetUp={isSetUp} status={status} />
        </form>
      </CardContent>
    </Card>
  );
}
