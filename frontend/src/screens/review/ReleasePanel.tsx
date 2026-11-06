import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n/use-i18n";
import { cn } from "@/lib/utils";

import { FilmSearch } from "./FilmSearch";
import {
  assignRelease,
  discardRelease,
  isNotPending,
  type FilmChoice,
  type PendingRelease,
} from "./review-api";
import { DESTRUCTIVE_TEXT } from "./tone";

type Props = {
  id: string;
  release: PendingRelease;
  shouldFocusSearch: boolean;
  /** The release has left the queue; `notice` says how. */
  onResolved: (notice: string) => void;
};

function initialSearch({ parsed_title, caption }: PendingRelease): string {
  return parsed_title || caption?.split("\n")[0] || "";
}

export function ReleasePanel({ id, release, shouldFocusSearch, onResolved }: Props) {
  const { t, tn, errorText } = useI18n();
  const [typedId, setTypedId] = useState("");
  const typed = typedId.trim();

  function handleError(error: Error) {
    if (isNotPending(error)) onResolved(tn("review.bulk_gone", 1));
  }

  const assign = useMutation({
    mutationFn: (choice: FilmChoice) => assignRelease(release, choice),
    onSuccess: ({ title }) => onResolved(t("review.offered", { title })),
    onError: handleError,
  });
  const discard = useMutation({
    mutationFn: () => discardRelease(release),
    onSuccess: () => onResolved(t("review.discarded")),
    onError: handleError,
  });
  const failure = assign.error ?? discard.error;
  const isBusy = assign.isPending || discard.isPending;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (typed && !isBusy) assign.mutate({ typed_id: typed });
  }

  return (
    <div id={id} className="flex flex-col gap-4 border-t bg-muted/30 p-3 sm:pl-10">
      {release.caption && <p className="text-sm whitespace-pre-line wrap-anywhere">{release.caption}</p>}
      <FilmSearch
        initialQuery={initialSearch(release)}
        shouldFocus={shouldFocusSearch}
        isDisabled={isBusy}
        onPick={(film) => assign.mutate({ tmdb_id: film.tmdb_id })}
      />
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <form onSubmit={handleSubmit} className="flex min-w-0 flex-1 basis-72 flex-col gap-1.5">
          <label htmlFor={`${id}-film-id`} className="text-xs text-muted-foreground">
            {t("review.id_placeholder")}
          </label>
          <div className="flex gap-2">
            <Input
              id={`${id}-film-id`}
              value={typedId}
              onChange={(event) => setTypedId(event.target.value)}
              className="h-11 min-w-0 flex-1 sm:h-9"
            />
            <Button type="submit" size="lg" disabled={!typed || isBusy} className="h-11 sm:h-9">
              {assign.isPending ? t("review.assigning") : t("review.assign")}
            </Button>
          </div>
        </form>
        <Button
          type="button"
          variant="destructive"
          size="lg"
          disabled={isBusy}
          onClick={() => discard.mutate()}
          className={cn("h-11 sm:h-9", DESTRUCTIVE_TEXT)}
        >
          {discard.isPending ? t("review.discarding") : t("review.discard")}
        </Button>
      </div>
      {failure && (
        <p role="alert" className={cn("text-sm", DESTRUCTIVE_TEXT)}>
          {errorText(failure)}
        </p>
      )}
    </div>
  );
}
