import { useSyncExternalStore } from "react";

import { Toaster } from "@/components/ui/sonner";
import { useI18n } from "@/i18n/use-i18n";
import { currentTheme, subscribeToTheme } from "@/lib/theme";

const TOAST_MS = 3200;

/** The shell's toasts: screens raise them with `toast` from sonner. */
export function AppToaster() {
  const { t } = useI18n();
  const theme = useSyncExternalStore(subscribeToTheme, currentTheme);

  return (
    <Toaster
      theme={theme === "auto" ? "system" : theme}
      duration={TOAST_MS}
      containerAriaLabel={t("shell.notifications")}
    />
  );
}
