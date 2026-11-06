import { useEffect, useRef, useState } from "react";

import type { CatalogView, FilterId } from "@/screens/channels/catalog/catalog";

const SEARCH_DELAY_MS = 250;

/** What the operator chose to see. A new search or filter starts again from page 1. */
export function useCatalogView() {
  const [view, setView] = useState<CatalogView>({ q: "", filter: "all", page: 1 });
  const [searchText, setSearchText] = useState("");
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(searchTimer.current), []);

  const applySearch = (q: string) =>
    setView((current) => (current.q === q ? current : { ...current, q, page: 1 }));

  return {
    view,
    searchText,
    changeSearch: (text: string) => {
      setSearchText(text);
      clearTimeout(searchTimer.current);
      searchTimer.current = setTimeout(() => applySearch(text.trim()), SEARCH_DELAY_MS);
    },
    clearSearch: () => {
      clearTimeout(searchTimer.current);
      setSearchText("");
      applySearch("");
    },
    pickFilter: (filter: FilterId) => setView((current) => ({ ...current, filter, page: 1 })),
    goToPage: (page: number) => setView((current) => ({ ...current, page })),
  };
}
