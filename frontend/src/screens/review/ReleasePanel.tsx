import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/use-i18n";

import { FilmSearch } from "./FilmSearch";
import {
  assignRelease,
  discardRelease,
  isNotPending,
  type FilmChoice,
  type FilmHit,
  type PendingRelease,
} from "./review-api";
import { TypedFilmId } from "./TypedFilmId";

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
  // One candidate at a time: picking a hit clears the typed id, typing clears the pick.
  const [selected, setSelected] = useState<FilmHit | null>(null);
  const [typedId, setTypedId] = useState("");

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
  const inFlight = assign.isPending ? assign.variables : null;
  const assigningHit = inFlight && "tmdb_id" in inFlight ? selected : null;

  function selectHit(film: FilmHit) {
    setSelected(film);
    setTypedId("");
  }

  function changeTypedId(value: string) {
    setTypedId(value);
    setSelected(null);
  }

  return (
    <div id={id} className="flex flex-col gap-4 border-t bg-muted/30 p-3 sm:pl-10">
      {release.caption && <p className="text-sm whitespace-pre-line wrap-anywhere">{release.caption}</p>}
      <FilmSearch
        initialQuery={initialSearch(release)}
        year={release.year}
        shouldFocus={shouldFocusSearch}
        isDisabled={isBusy}
        selected={selected}
        assigning={assigningHit}
        onSelect={selectHit}
        onAssign={(film) => assign.mutate({ tmdb_id: film.tmdb_id })}
      />
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <TypedFilmId
          id={`${id}-film-id`}
          value={typedId}
          isBusy={isBusy}
          isAssigning={inFlight !== null && "typed_id" in inFlight}
          onChange={changeTypedId}
          onAssign={(typed) => assign.mutate({ typed_id: typed })}
        />
        <Button
          type="button"
          variant="destructive"
          size="lg"
          disabled={isBusy}
          onClick={() => discard.mutate()}
          // Level with the id field: below its text-xs label (1rem) and the gap-1.5 under it.
          className="h-11 sm:mt-5.5 sm:h-9"
        >
          {discard.isPending ? t("review.discarding") : t("review.discard")}
        </Button>
      </div>
      {failure && (
        <p role="alert" className="text-sm text-destructive">
          {errorText(failure)}
        </p>
      )}
    </div>
  );
}
