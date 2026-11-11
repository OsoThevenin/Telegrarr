import { useQuery } from "@tanstack/react-query";

import { useI18n } from "@/i18n/use-i18n";
import { statusQuery } from "@/lib/status";
import { cn } from "@/lib/utils";

/** A dot beside the page title: green while Telegram is signed in, red when it is not. */
export function TelegramDot() {
  const { t } = useI18n();
  const { data: status } = useQuery(statusQuery);

  if (!status) return null;
  const label = status.authorized ? t("shell.tg_connected") : t("shell.tg_offline");
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn("size-2 shrink-0 rounded-full", status.authorized ? "bg-success" : "bg-destructive")}
    />
  );
}
