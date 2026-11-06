import { useEffect } from "react";

import { Outlet, useMatches } from "@tanstack/react-router";

import { AppToaster } from "@/app/AppToaster";
import { CommandPalette } from "@/app/CommandPalette";
import { MobileDrawer } from "@/app/MobileDrawer";
import { ShellBanners } from "@/app/ShellBanners";
import { ShellMenu } from "@/app/ShellMenu";
import { useLiveUpdates } from "@/app/use-live-updates";
import { useI18n } from "@/i18n/use-i18n";

const APP_NAME = "Telegrarr";

export function Shell() {
  const { t } = useI18n();
  useLiveUpdates();
  const titleKey = useMatches({
    select: (matches) => matches.findLast((match) => match.staticData.titleKey)?.staticData.titleKey,
  });
  const HeaderAction = useMatches({
    select: (matches) => matches.findLast((match) => match.staticData.HeaderAction)?.staticData.HeaderAction,
  });
  const title = titleKey ? t(titleKey) : undefined;

  useEffect(() => {
    document.title = title ? `${title} · ${APP_NAME}` : APP_NAME;
  }, [title]);

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:block">
        <ShellMenu />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center gap-2 border-b bg-background px-2 md:px-8">
          <MobileDrawer />
          <h1 className="truncate text-lg font-semibold">{title ?? APP_NAME}</h1>
          <CommandPalette />
          {HeaderAction && <HeaderAction />}
        </header>
        <ShellBanners />
        <main className="flex-1 p-4 md:p-8">
          <Outlet />
        </main>
      </div>
      <AppToaster />
    </div>
  );
}
