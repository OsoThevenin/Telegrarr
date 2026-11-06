import { useEffect, useRef, useState } from "react";

import { useMutation } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { useSettings } from "@/lib/settings";
import type { Channel } from "@/screens/channels/channel";
import {
  exactHit,
  MIN_QUERY_LENGTH,
  seriesQuery,
  seriesSearchUrl,
  type SeriesHit,
} from "@/screens/channels/series-query";

const SEARCH_DEBOUNCE_MS = 350;

/** The body of PUT /api/channels/{id}/series. */
export type SeriesPayload = { tmdb_id: number | null; tvdb_id: string | null; title: string };

type SeriesChoice = { tmdb_id: number; title: string };
type SeriesSearch = { term: string; digitsAsId: boolean };

/** The series block's state. It lives above the block, so hiding the block keeps the choice. */
export function useSeriesMapping(source?: Channel) {
  const [query, setQuery] = useState(source?.imdb_title ?? "");
  const [isQueryTouched, setIsQueryTouched] = useState(false);
  const [choice, setChoice] = useState<SeriesChoice | null>(null);
  const [tvdb, setTvdb] = useState({ value: source?.tvdb_id ? String(source.tvdb_id) : "", isEdited: false });
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hasTmdbKey = useSettings().data?.settings.tmdb_key_set;
  const search = useMutation({
    mutationFn: ({ term, digitsAsId }: SeriesSearch) => api.get<SeriesHit[]>(seriesSearchUrl(term, digitsAsId)),
  });

  useEffect(() => () => clearTimeout(timer.current), []);

  const choose = ({ tmdb_id, title, year }: SeriesHit) => {
    clearTimeout(timer.current);
    search.reset();
    setChoice({ tmdb_id, title: year ? `${title} (${year})` : title });
    setQuery(title);
    setIsQueryTouched(true);
    setTvdb((current) => (current.isEdited ? current : { value: "", isEdited: false }));
  };

  const runSearch = (typed: string, digitsAsId: boolean) => {
    const term = typed.trim();
    if (term.length < MIN_QUERY_LENGTH) {
      search.reset();
      return;
    }

    search.mutate(
      { term, digitsAsId },
      {
        onSuccess: (hits) => {
          const exact = exactHit(hits);
          if (exact) choose(exact);
        },
      },
    );
  };

  const changeQuery = (value: string) => {
    clearTimeout(timer.current);
    if (search.isPending) search.reset();
    setQuery(value);
    setIsQueryTouched(true);
    timer.current = setTimeout(() => runSearch(value, false), SEARCH_DEBOUNCE_MS);
  };

  /** Enter is the one place plain digits read as a TMDB id. */
  const searchNow = () => {
    clearTimeout(timer.current);
    runSearch(query, true);
  };

  /** Starts from a chat's name, unless the search is already the person's own. */
  const prefill = (chatTitle: string) => {
    if (isQueryTouched) return;

    const term = seriesQuery(chatTitle);
    setQuery(term);
    if (hasTmdbKey !== false) runSearch(term, false);
  };

  const typedTvdb = tvdb.value.trim();
  const editedTvdb = tvdb.isEdited && typedTvdb ? typedTvdb : null;
  const payload: SeriesPayload | null =
    choice || editedTvdb
      ? { tmdb_id: choice?.tmdb_id ?? null, tvdb_id: editedTvdb, title: choice?.title ?? "" }
      : null;

  return {
    query,
    changeQuery,
    searchNow,
    prefill,
    choose,
    choice,
    tvdb: tvdb.value,
    changeTvdb: (value: string) => setTvdb({ value, isEdited: true }),
    search,
    isTmdbKeyMissing: hasTmdbKey === false,
    payload,
  };
}

export type SeriesMapping = ReturnType<typeof useSeriesMapping>;
