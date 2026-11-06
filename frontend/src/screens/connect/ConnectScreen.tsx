import type { ReactNode } from "react";

import { StatusLine } from "@/components/StatusLine";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/use-i18n";
import { ARR_APPS, useSettings } from "@/lib/settings";
import { AppCard } from "@/screens/connect/AppCard";
import { ManualSetup } from "@/screens/connect/ManualSetup";
import { RadarrDefaults } from "@/screens/connect/RadarrDefaults";
import { RegisterCard } from "@/screens/connect/RegisterCard";

type StepProps = {
  number: number;
  title: string;
  children: ReactNode;
};

function Step({ number, title, children }: StepProps) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 text-base font-medium">
        <span
          aria-hidden="true"
          className="flex size-6 items-center justify-center rounded-full bg-muted text-xs tabular-nums"
        >
          {number}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

export function ConnectScreen() {
  const { t, errorText } = useI18n();
  const query = useSettings();

  if (query.data) {
    const { settings, arr } = query.data;
    const isRadarrSetUp = Boolean(settings.radarr_url) && settings.radarr_key_set;

    return (
      <div className="mx-auto flex w-full max-w-180 flex-col gap-8">
        <Step number={1} title={t("connect.step_apps")}>
          {ARR_APPS.map((app) => (
            <AppCard key={app} app={app} settings={settings} />
          ))}
        </Step>
        <Step number={2} title={t("connect.register_title")}>
          <RegisterCard settings={settings} />
        </Step>
        {isRadarrSetUp && (
          <Step number={3} title={t("connect.step_defaults")}>
            <RadarrDefaults />
          </Step>
        )}
        <ManualSetup apikey={arr.apikey} />
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="flex flex-col items-start gap-2">
        <StatusLine tone="error">{errorText(query.error)}</StatusLine>
        <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>
          {t("common.retry")}
        </Button>
      </div>
    );
  }

  return <StatusLine tone="neutral">{t("common.loading")}</StatusLine>;
}
