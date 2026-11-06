import { useState, type FormEvent } from "react";

import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { SaveOutcomeLine } from "@/components/SaveOutcomeLine";
import { SecretField, secretPatch } from "@/components/SecretField";
import { StatusLine } from "@/components/StatusLine";
import { TestOutcome } from "@/components/TestOutcome";
import { TextField } from "@/components/TextField";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/i18n/use-i18n";
import { api } from "@/lib/api";
import { useSaveSettings, useSettingsForm, type Settings, type TestResult } from "@/lib/settings";
import { TelegramCard } from "@/screens/settings/TelegramCard";

type Props = {
  settings: Settings;
};

export function IntegrationsTab({ settings }: Props) {
  const { t } = useI18n();

  return (
    <>
      <TelegramCard settings={settings} />
      <TmdbCard settings={settings} />
      <PlexCard settings={settings} />
      <NotificationsCard settings={settings} />
      <Card>
        <CardHeader>
          <CardTitle>{t("set.arr")}</CardTitle>
          <CardDescription>
            <Link to="/connect" className="text-primary underline-offset-4 hover:underline">
              {t("set.arr_open_connect")}
            </Link>
          </CardDescription>
        </CardHeader>
      </Card>
    </>
  );
}

function ConfiguredBadge({ isConfigured }: { isConfigured: boolean }) {
  const { t } = useI18n();

  return (
    <Badge variant={isConfigured ? "secondary" : "outline"}>
      {t(isConfigured ? "set.status.configured" : "set.status.not_configured")}
    </Badge>
  );
}

function useTestEndpoint(path: string) {
  return useMutation<TestResult, unknown, void>({
    mutationFn: () => api.post<TestResult>(path, {}),
  });
}

const NO_FIELDS = [] as const;

function TmdbCard({ settings }: Props) {
  const { t } = useI18n();
  const form = useSettingsForm(settings, NO_FIELDS);
  const save = useSaveSettings();
  const test = useTestEndpoint("/api/integrations/tmdb/test");
  const [draft, setDraft] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!(await form.submit(secretPatch("tmdb_key", draft)))) return;
    setDraft(null);
    test.mutate();
  }

  async function handleClear() {
    await save.mutateAsync({ tmdb_key: "" });
    setDraft(null);
    test.reset();
  }

  const canSubmit = settings.tmdb_key_set || Boolean(draft?.trim());

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("set.tmdb")}</CardTitle>
        <CardDescription>{t("set.tmdb_intro")}</CardDescription>
        <CardAction>
          <ConfiguredBadge isConfigured={settings.tmdb_key_set} />
        </CardAction>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col items-start gap-3" onSubmit={(event) => void handleSubmit(event)}>
          <div className="w-full">
            <SecretField
              label={t("common.api_key")}
              state={{ kind: settings.tmdb_key_set ? "saved" : "empty" }}
              draft={draft}
              onDraftChange={setDraft}
              onClear={handleClear}
            />
          </div>
          <Button type="submit" variant="outline" size="sm" disabled={!canSubmit || form.isSaving || test.isPending}>
            {t("common.save_test")}
          </Button>
          <SaveOutcomeLine outcome={form.outcome} savedText={t("set.tmdb_saved")} />
          <TestOutcome test={test} />
          <p className="text-xs text-muted-foreground">{t("set.tmdb_attribution")}</p>
        </form>
      </CardContent>
    </Card>
  );
}

const PLEX_KEYS = ["plex_url"] as const;

function PlexCard({ settings }: Props) {
  const { t } = useI18n();
  const { form, setField, isSaving, outcome, submit } = useSettingsForm(settings, PLEX_KEYS);
  const save = useSaveSettings();
  const test = useTestEndpoint("/api/integrations/plex/test");
  const [draft, setDraft] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!(await submit(secretPatch("plex_token", draft)))) return;
    setDraft(null);
    test.mutate();
  }

  async function handleClear() {
    await save.mutateAsync({ plex_token: "" });
    setDraft(null);
    test.reset();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Plex</CardTitle>
        <CardAction>
          <ConfiguredBadge isConfigured={Boolean(settings.plex_url) && settings.plex_token_set} />
        </CardAction>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col items-start gap-3" onSubmit={(event) => void handleSubmit(event)}>
          <div className="flex w-full flex-col gap-3">
            <TextField
              label={t("set.plex_url")}
              type="url"
              placeholder="http://plex:32400"
              className="font-mono"
              value={form.plex_url}
              onChange={(event) => setField("plex_url", event.target.value)}
            />
            <SecretField
              label={t("set.plex_token")}
              state={{ kind: settings.plex_token_set ? "saved" : "empty" }}
              draft={draft}
              onDraftChange={setDraft}
              onClear={handleClear}
            />
          </div>
          <Button type="submit" variant="outline" size="sm" disabled={isSaving || test.isPending}>
            {t("common.save_test")}
          </Button>
          <SaveOutcomeLine outcome={outcome} savedText={t("set.plex_saved")} />
          <TestOutcome test={test} />
        </form>
      </CardContent>
    </Card>
  );
}

const WEBHOOK_KEYS = ["notify_webhook"] as const;

function NotificationsCard({ settings }: Props) {
  const { t, errorText } = useI18n();
  const { form, setField, isDirty, isSaving, outcome, submit } = useSettingsForm(settings, WEBHOOK_KEYS);
  const saveDm = useSaveSettings();
  const test = useTestEndpoint("/api/integrations/notify/test");

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void submit();
  }

  const dmState = t(settings.notify_telegram ? "set.tg_dm_on" : "set.tg_dm_off");

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("set.notifications")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="settings-notify-telegram">{dmState}</Label>
            <Switch
              id="settings-notify-telegram"
              checked={settings.notify_telegram}
              disabled={saveDm.isPending}
              onCheckedChange={(isOn) => saveDm.mutate({ notify_telegram: isOn })}
            />
          </div>
          <p className="text-xs text-muted-foreground">{t("set.tg_dm_hint")}</p>
          {saveDm.isError && <StatusLine tone="error">{errorText(saveDm.error)}</StatusLine>}
        </div>
        <form className="flex flex-col items-start gap-2" onSubmit={handleSubmit}>
          <div className="w-full">
            <TextField
              label={t("set.webhook_url")}
              hint={t("set.webhook_hint")}
              type="url"
              className="font-mono"
              value={form.notify_webhook}
              onChange={(event) => setField("notify_webhook", event.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={!isDirty || isSaving}>
              {t("set.save_webhook")}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={isDirty || test.isPending}
              onClick={() => test.mutate()}
            >
              {test.isPending ? t("set.sending") : t("set.send_test")}
            </Button>
          </div>
          <SaveOutcomeLine outcome={outcome} savedText={t("set.webhook_saved")} />
          {!test.isPending && <TestOutcome test={test} />}
        </form>
      </CardContent>
    </Card>
  );
}
