import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/use-i18n";

type Props = {
  error: unknown;
  onRetry: () => void;
};

/** What a screen shows, in place of its content, when its data did not load. */
export function LoadError({ error, onRetry }: Props) {
  const { t, errorText } = useI18n();

  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4 text-sm">
      <span className="text-destructive">{errorText(error)}</span>
      <Button variant="outline" size="sm" onClick={onRetry}>
        {t("common.retry")}
      </Button>
    </div>
  );
}
