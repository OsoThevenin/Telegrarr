import { useState, type FormEvent } from "react";

import { useMutation } from "@tanstack/react-query";

import { StatusLine, type StatusTone } from "@/components/StatusLine";
import { TextField } from "@/components/TextField";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { useI18n } from "@/i18n/use-i18n";
import { api, type ServerMessage } from "@/lib/api";
import { ARR_APPS, useSaveSettings, type ArrApp, type Settings } from "@/lib/settings";
import { appName } from "@/screens/connect/AppCard";

const LOOPBACK_URL = /^https?:\/\/(localhost|127\.|\[::1\]|0\.0\.0\.0)/i;

type RegisterStatus = "created" | "exists" | "skipped" | "error";

type RegisterResult = {
  app: ArrApp;
  kind: "indexer" | "download_client";
  status: RegisterStatus;
  error?: ServerMessage;
};

const STATUS_TONES: Record<RegisterStatus, StatusTone> = {
  created: "success",
  exists: "success",
  skipped: "neutral",
  error: "error",
};

const STATUS_KEYS: Record<RegisterStatus, string> = {
  created: "connect.status.created",
  exists: "connect.status.exists",
  skipped: "connect.status.skipped",
  error: "connect.status.error",
};

const KIND_KEYS: Record<RegisterResult["kind"], string> = {
  indexer: "connect.kind.indexer",
  download_client: "connect.kind.download_client",
};

export function RegisterCard({ settings }: { settings: Settings }) {
  const { t, errorText } = useI18n();
  const save = useSaveSettings();
  const [ownUrl, setOwnUrl] = useState(settings.telegrarr_url || location.origin);

  const canRegister = ARR_APPS.some((app) => settings[`${app}_url`] && settings[`${app}_key_set`]);
  const isSuggestion = !settings.telegrarr_url && ownUrl === location.origin;
  const isLoopback = LOOPBACK_URL.test(ownUrl.trim());

  const register = useMutation({
    mutationFn: async () => {
      const url = ownUrl.trim();
      if (url !== settings.telegrarr_url) {
        const saved = await save.mutateAsync({ telegrarr_url: url });
        setOwnUrl(saved.telegrarr_url);
      }
      const { results } = await api.post<{ results: RegisterResult[] }>("/api/connect/register", {});
      return results;
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    register.mutate();
  }

  return (
    <Card>
      <CardHeader>
        <CardDescription>{t("connect.register_intro")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col items-start gap-3" onSubmit={handleSubmit}>
          <div className="w-full">
            <TextField
              label={t("connect.own_url")}
              hint={t("connect.own_url_hint")}
              type="url"
              required
              className="font-mono"
              value={ownUrl}
              onChange={(event) => setOwnUrl(event.target.value)}
            />
          </div>
          {isSuggestion && <StatusLine tone="neutral">{t("connect.own_url_suggestion")}</StatusLine>}
          {isLoopback && <StatusLine tone="warning">{t("connect.own_url_loopback")}</StatusLine>}
          <Button type="submit" size="sm" disabled={!canRegister || register.isPending}>
            {t("connect.register_title")}
          </Button>
          {!canRegister && <StatusLine tone="neutral">{t("connect.register_blocked")}</StatusLine>}
          {register.isError && <StatusLine tone="error">{errorText(register.error)}</StatusLine>}
          {register.data && <RegisterResults results={register.data} />}
        </form>
      </CardContent>
    </Card>
  );
}

function RegisterResults({ results }: { results: RegisterResult[] }) {
  const { t, tn, msg } = useI18n();
  const created = results.filter(({ status }) => status === "created").length;
  const hasFailure = results.some(({ status }) => status === "error");

  return (
    <div className="flex flex-col gap-1">
      {created > 0 && <StatusLine tone="success">{tn("connect.registered", created)}</StatusLine>}
      {created === 0 && !hasFailure && <StatusLine tone="neutral">{t("connect.nothing_new")}</StatusLine>}
      <ul className="flex flex-col gap-1">
        {results.map(({ app, kind, status, error }) => (
          <li key={`${app}-${kind}`}>
            <StatusLine tone={STATUS_TONES[status]}>
              {appName(app)} · {t(KIND_KEYS[kind])}: {t(STATUS_KEYS[status])}
              {error ? ` — ${msg(error)}` : ""}
            </StatusLine>
          </li>
        ))}
      </ul>
    </div>
  );
}
