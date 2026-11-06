import { useState } from "react";

import type { Download } from "@/lib/downloads";

type DownloadId = Download["id"];

export type DownloadSelection = {
  /** The chosen rows still in view: a row filtered out or finished is never acted on. */
  selected: Download[];
  isSelected: (id: DownloadId) => boolean;
  toggle: (id: DownloadId, isSelected: boolean) => void;
  toggleAll: (isSelected: boolean) => void;
  clear: () => void;
};

/** The rows ticked among `rows`, the ones a tab shows. */
export function useDownloadSelection(rows: readonly Download[]): DownloadSelection {
  const [ids, setIds] = useState<ReadonlySet<DownloadId>>(new Set());

  const toggleMany = (targets: readonly DownloadId[], isSelected: boolean) =>
    setIds((current) =>
      isSelected ? new Set([...current, ...targets]) : new Set([...current].filter((id) => !targets.includes(id))),
    );

  return {
    selected: rows.filter(({ id }) => ids.has(id)),
    isSelected: (id) => ids.has(id),
    toggle: (id, isSelected) => toggleMany([id], isSelected),
    toggleAll: (isSelected) =>
      toggleMany(
        rows.map(({ id }) => id),
        isSelected,
      ),
    clear: () => setIds(new Set()),
  };
}
