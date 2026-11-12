import { Progress } from "@/components/ui/progress";
import { useI18n } from "@/i18n/use-i18n";
import { useFormat } from "@/lib/use-format";
import type { Channel } from "@/screens/channels/channel";

const PERCENT = 100;

/** How far the background fetch of a source's older messages has got. */
export function HistoryProgress({ history }: { history: Channel["history"] }) {
  const { t, tn, locale } = useI18n();
  const { when } = useFormat();
  const { read, total_estimate: total, complete, next_batch_at: nextBatchAt } = history;

  if (!complete && !read && nextBatchAt === null) return null;

  const isDue = nextBatchAt !== null && nextBatchAt * 1000 <= Date.now();
  const nextBatch = isDue ? t("ch.history_next_due") : nextBatchAt && t("ch.history_next", { when: when(nextBatchAt) });
  const percent = !complete && total ? Math.round((read / total) * PERCENT) : null;
  const readText =
    percent === null
      ? tn("ch.history_read", read)
      : t("ch.history_read_of", { read: read.toLocaleString(locale), total: total?.toLocaleString(locale) });

  return (
    <div className="flex flex-col gap-1.5 border-t pt-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <span className="font-medium">{t("ch.history")}</span>
        <span className="text-xs text-muted-foreground">{complete ? t("ch.history_complete") : nextBatch}</span>
      </div>
      {percent !== null && <Progress value={percent} aria-valuenow={percent} aria-label={t("ch.history")} />}
      <span className="text-xs text-muted-foreground">{readText}</span>
    </div>
  );
}
