import { useState, type ReactNode } from "react";

import { useQuery } from "@tanstack/react-query";
import { Link, useMatches } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/use-i18n";
import { statusQuery } from "@/lib/status";
import { useFormat } from "@/lib/use-format";
import { useTelegramAuth } from "@/screens/settings/telegram-api";
import { TelegramSignInDialog } from "@/screens/settings/TelegramSignInDialog";

type BannerProps = {
  text: string;
  action?: ReactNode;
};

function Banner({ text, action }: BannerProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted px-4 py-2 text-sm md:px-8">
      <p role="status">{text}</p>
      {action}
    </div>
  );
}

function TelegramBanner({ onSignIn }: { onSignIn: () => void }) {
  const { t } = useI18n();
  const { data: auth } = useTelegramAuth();
  const label = t("banner.connect_telegram");

  // The sign-in dialog needs the API credentials, which only Settings can take.
  const action = auth?.api_ready ? (
    <Button variant="outline" size="sm" onClick={onSignIn}>
      {label}
    </Button>
  ) : (
    <Button asChild variant="outline" size="sm">
      <Link to="/settings" search={{ tab: "integrations" }}>{label}</Link>
    </Button>
  );

  return <Banner text={t("banner.tg_offline")} action={action} />;
}

/** What stops every download, on every screen but the one with its own status line. */
export function ShellBanners() {
  const { t } = useI18n();
  const { time } = useFormat();
  const { data: status } = useQuery(statusQuery);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const hasOwnStatusLine = useMatches({
    select: (matches) => matches.some((match) => match.staticData.hasOwnStatusLine),
  });
  const budget = status?.budget;

  return (
    <>
      {!hasOwnStatusLine && status?.authorized === false && <TelegramBanner onSignIn={() => setIsSigningIn(true)} />}
      {!hasOwnStatusLine && budget?.exhausted && (
        <Banner text={t("budget.banner", { limit: budget.limit_gb, at: time(budget.resets_at) })} />
      )}
      {/* Outside the banner, whose sign-in ends with it gone and the last step still to show. */}
      <TelegramSignInDialog isOpen={isSigningIn} onOpenChange={setIsSigningIn} />
    </>
  );
}
