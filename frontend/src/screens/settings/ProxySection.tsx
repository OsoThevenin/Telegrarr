import { useState, type FormEvent } from "react";

import { useMutation } from "@tanstack/react-query";

import { SecretField, secretState } from "@/components/SecretField";
import { StatusLine } from "@/components/StatusLine";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/use-i18n";
import { isEnvLocked, isEnvRefusal, type Settings } from "@/lib/settings";
import { TelegramFailure, telegramPost, useRefreshTelegram, useTelegramProxy } from "@/screens/settings/telegram-api";
import { SMALL_BUTTON } from "@/lib/touch";

type ProxyResult = { proxy?: string };

export function ProxySection({ settings }: { settings: Settings }) {
  const { t, errorText } = useI18n();
  const proxy = useTelegramProxy();
  const refresh = useRefreshTelegram();
  const [draft, setDraft] = useState<string | null>(null);
  const [wasCleared, setWasCleared] = useState(false);

  const connect = useMutation({
    mutationFn: () => telegramPost<ProxyResult>("/api/telegram/proxy", { proxy: draft?.trim() }),
    // A failure to connect through the proxy arrives in a 200 and the proxy is saved all the same.
    // An env refusal arrives the same way, but nothing was saved, so the draft stays.
    onSettled: async (_result, error) => {
      await refresh();
      const wasSaved = !error || (error instanceof TelegramFailure && !isEnvRefusal(error));
      if (wasSaved) setDraft(null);
    },
  });

  async function handleClear() {
    connect.reset();
    await telegramPost("/api/telegram/proxy", { proxy: "" });
    await refresh();
    setDraft(null);
    setWasCleared(true);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setWasCleared(false);
    connect.mutate();
  }

  return (
    <form className="flex flex-col items-start gap-3 border-t pt-4" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">{t("set.proxy")}</h3>
        <p className="text-sm text-muted-foreground">{t("set.proxy_intro")}</p>
      </div>
      <div className="w-full max-w-md">
        <SecretField
          label={t("set.proxy_url")}
          state={secretState(settings, "tg_proxy", settings.proxy_set, proxy.data?.proxy)}
          draft={draft}
          onDraftChange={setDraft}
          onClear={handleClear}
          placeholder="socks5://user:pass@host:1080"
        />
      </div>
      {!isEnvLocked(settings, "tg_proxy") && (
        <Button
          type="submit"
          variant="outline"
          size="sm"
          className={SMALL_BUTTON}
          disabled={!draft?.trim() || connect.isPending}
        >
          {t("set.proxy_connect")}
        </Button>
      )}
      {connect.isPending && <StatusLine tone="neutral">{t("set.proxy_connecting")}</StatusLine>}
      {connect.isError && <StatusLine tone="error">{errorText(connect.error)}</StatusLine>}
      {connect.isSuccess && (
        <StatusLine tone="success">
          {t("set.proxy_connected", { via: connect.data.proxy || t("set.proxy_direct") })}
        </StatusLine>
      )}
      {wasCleared && <StatusLine tone="success">{t("set.proxy_cleared")}</StatusLine>}
    </form>
  );
}
