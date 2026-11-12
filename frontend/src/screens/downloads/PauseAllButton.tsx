import { Pause, Play } from "lucide-react";

import { useQueuePause } from "@/app/use-queue-pause";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/use-i18n";

/** The queue's own switch, beside Select all: it acts on the whole queue, not on the selection. */
export function PauseAllButton() {
  const { t } = useI18n();
  const { isPaused, isPending, toggle } = useQueuePause();
  const Icon = isPaused ? Play : Pause;

  return (
    <Button variant="quiet" size="sm" disabled={isPaused === undefined || isPending} onClick={toggle}>
      <Icon aria-hidden="true" />
      {isPaused ? t("dl.resume_all") : t("dl.pause_all")}
    </Button>
  );
}
