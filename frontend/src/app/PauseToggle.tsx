import { Pause, Play } from "lucide-react";

import { useQueuePause } from "@/app/use-queue-pause";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/use-i18n";

export function PauseToggle() {
  const { t } = useI18n();
  const { isPaused, isPending, toggle } = useQueuePause();
  const Icon = isPaused ? Play : Pause;

  return (
    <Button variant="outline" disabled={isPaused === undefined || isPending} onClick={toggle}>
      <Icon aria-hidden="true" />
      {isPaused ? t("shell.resume") : t("shell.pause")}
    </Button>
  );
}
