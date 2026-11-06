import { useState, type FormEvent } from "react";

import { useMutation } from "@tanstack/react-query";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { LockedSecret, SecretField } from "@/components/SecretField";
import { StatusLine } from "@/components/StatusLine";
import { TextField } from "@/components/TextField";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/i18n/use-i18n";
import { isEnvLocked, type Settings } from "@/lib/settings";
import { ProxySection } from "@/screens/settings/ProxySection";
import { telegramPost, useRefreshTelegram, useTelegramAuth } from "@/screens/settings/telegram-api";
import { TelegramSignInDialog } from "@/screens/settings/TelegramSignInDialog";

export function TelegramCard({ settings }: { settings: Settings }) {
  const { t, errorText } = useI18n();
  const auth = useTelegramAuth();
  const refresh = useRefreshTelegram();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isConfirmingLogout, setIsConfirmingLogout] = useState(false);
  const [wasDisconnected, setWasDisconnected] = useState(false);

  const isAuthorized = auth.data?.authorized ?? false;

  async function handleLogout() {
    await telegramPost("/api/telegram/auth/logout");
    await refresh();
    setWasDisconnected(true);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("set.tg_account")}</CardTitle>
        <CardDescription>{t(isAuthorized ? "set.tg_connected" : "set.tg_not_connected")}</CardDescription>
        <CardAction>
          <Badge variant={isAuthorized ? "secondary" : "outline"}>
            {t(isAuthorized ? "set.status.connected" : "set.status.not_connected")}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {auth.isError && <StatusLine tone="error">{errorText(auth.error)}</StatusLine>}
        <ApiCredentialsSection settings={settings} isReady={auth.data?.api_ready ?? false} />
        <div className="flex flex-col items-start gap-2">
          {isAuthorized ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setIsConfirmingLogout(true)}>
              {t("set.tg_disconnect")}
            </Button>
          ) : (
            <Button type="button" size="sm" disabled={!auth.data?.api_ready} onClick={() => setIsSigningIn(true)}>
              {t("banner.connect_telegram")}
            </Button>
          )}
          {wasDisconnected && !isAuthorized && <StatusLine tone="success">{t("set.tg_disconnected")}</StatusLine>}
        </div>
        <ProxySection settings={settings} />
      </CardContent>
      <TelegramSignInDialog isOpen={isSigningIn} onOpenChange={setIsSigningIn} />
      <ConfirmDialog
        isOpen={isConfirmingLogout}
        onOpenChange={setIsConfirmingLogout}
        title={t("set.tg_disconnect")}
        description={t("set.tg_disconnect_confirm")}
        confirmLabel={t("set.tg_disconnect")}
        onConfirm={handleLogout}
        isDestructive
      />
    </Card>
  );
}

type ApiCredentialsSectionProps = {
  settings: Settings;
  isReady: boolean;
};

/** The endpoint writes the ID and the hash together, so one locked value freezes the pair. */
function ApiCredentialsSection({ settings, isReady }: ApiCredentialsSectionProps) {
  const { t } = useI18n();
  const isIdLocked = isEnvLocked(settings, "tg_api_id");
  const isHashLocked = isEnvLocked(settings, "tg_api_hash");

  if (!isIdLocked && !isHashLocked) return <ApiCredentials isReady={isReady} />;

  return (
    <div className="flex flex-col gap-3">
      {isIdLocked && <LockedSecret label={t("set.tg_api_id")} />}
      {isHashLocked && <LockedSecret label={t("set.tg_api_hash")} />}
      {isIdLocked !== isHashLocked && !isReady && (
        <p className="text-sm text-muted-foreground">{t("set.tg_api_env_pair")}</p>
      )}
    </div>
  );
}

/** The app credentials. The saved API ID is not exposed, so a new hash needs it typed again. */
function ApiCredentials({ isReady }: { isReady: boolean }) {
  const { t, errorText } = useI18n();
  const refresh = useRefreshTelegram();
  const [apiId, setApiId] = useState("");
  const [hash, setHash] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => telegramPost("/api/telegram/auth/api", { api_id: apiId.trim(), api_hash: hash?.trim() }),
    onSuccess: async () => {
      await refresh();
      setApiId("");
      setHash(null);
    },
  });

  async function handleClear() {
    await telegramPost("/api/telegram/auth/api", { api_id: 0, api_hash: "" });
    await refresh();
    setApiId("");
    setHash(null);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  const isEditing = !isReady || hash !== null;
  const canSave = apiId.trim() !== "" && Boolean(hash?.trim());

  return (
    <form className="flex flex-col items-start gap-3" onSubmit={handleSubmit}>
      {!isReady && <p className="text-sm text-muted-foreground">{t("set.tg_api_intro")}</p>}
      <div className="flex w-full flex-col gap-3">
        <SecretField
          label={t("set.tg_api_hash")}
          state={{ kind: isReady ? "saved" : "empty" }}
          draft={hash}
          onDraftChange={setHash}
          onClear={handleClear}
        />
        {isEditing && (
          <TextField
            label={t("set.tg_api_id")}
            inputMode="numeric"
            autoComplete="off"
            value={apiId}
            onChange={(event) => setApiId(event.target.value)}
          />
        )}
      </div>
      {isEditing && (
        <Button type="submit" variant="outline" size="sm" disabled={!canSave || save.isPending}>
          {save.isPending ? t("common.saving") : t("common.save")}
        </Button>
      )}
      {save.isError && <StatusLine tone="error">{errorText(save.error)}</StatusLine>}
    </form>
  );
}
