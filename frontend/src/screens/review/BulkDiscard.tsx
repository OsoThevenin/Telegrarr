import { useMutation } from "@tanstack/react-query";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/use-i18n";

import { releaseName } from "./release-text";
import { discardAll, releaseKey, type BulkOutcome, type PendingRelease } from "./review-api";

type Props = {
  selected: PendingRelease[];
  hiddenCount: number;
  onClear: () => void;
  onStart: () => void;
  onSettled: (outcome: BulkOutcome) => void;
};

export function BulkDiscard({ selected, hiddenCount, onClear, onStart, onSettled }: Props) {
  const { t, tn } = useI18n();
  const discard = useMutation({
    mutationFn: () => discardAll(selected),
    onMutate: onStart,
    onSuccess: onSettled,
  });

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
      <span className="tabular-nums">{tn("review.selected", selected.length)}</span>
      {hiddenCount > 0 && (
        <span className="text-muted-foreground tabular-nums">
          {tn("review.hidden_by_filters", hiddenCount)}
        </span>
      )}
      <Button type="button" variant="ghost" size="sm" onClick={onClear} className="h-11 sm:h-7">
        {t("review.clear_selection")}
      </Button>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={discard.isPending}
            className="h-11 sm:h-7"
          >
            {discard.isPending ? t("review.discarding") : t("review.bulk_discard")}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tn("review.bulk_title", selected.length)}</AlertDialogTitle>
            <AlertDialogDescription>{t("review.bulk_body")}</AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="max-h-48 min-w-0 overflow-y-auto text-sm wrap-anywhere">
            {selected.map((release) => (
              <li key={releaseKey(release)} className="py-0.5">
                {releaseName(release, t)}
              </li>
            ))}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => discard.mutate()}
            >
              {t("review.discard")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
