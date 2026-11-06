import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n/use-i18n";

const DEFAULT_ROWS = 4;

type Props = {
  rows?: number;
};

/** Stands where content will appear, and tells assistive tech it is on its way. */
export function LoadingBlock({ rows = DEFAULT_ROWS }: Props) {
  const { t } = useI18n();

  return (
    <div role="status" aria-label={t("common.loading")} className="flex flex-col gap-2">
      {Array.from({ length: rows }, (_, row) => (
        <Skeleton key={row} className="h-9 w-full" />
      ))}
    </div>
  );
}
