import { useSyncExternalStore } from "react";

import { Moon, Sun, SunMoon, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/use-i18n";
import { currentTheme, cycleTheme, subscribeToTheme, type Theme } from "@/lib/theme";

const THEME_ICONS: Record<Theme, LucideIcon> = {
  auto: SunMoon,
  light: Sun,
  dark: Moon,
};

/** The header's theme switch: its icon shows the theme in force, a click moves on to the next. */
export function ThemeToggle() {
  const { t } = useI18n();
  const theme = useSyncExternalStore(subscribeToTheme, currentTheme);
  const Icon = THEME_ICONS[theme];

  return (
    <Button
      variant="ghost"
      size="icon-lg"
      className="size-11 sm:size-9"
      title={t("shell.theme")}
      aria-label={t("shell.theme_aria")}
      onClick={cycleTheme}
    >
      <Icon aria-hidden="true" />
    </Button>
  );
}
