import { DEFAULT_SORT, isSortOrder, type SortOrder } from "@/screens/downloads/download-list";

// The old UI's keys: the two UIs share this origin, so the choice carries across.
const SORT_KEY = "dl_sort";
const DENSITY_KEY = "density";
const DENSE = "1";
const COMFORTABLE = "0";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    // Blocked storage: start from the defaults.
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Blocked storage: the choice lasts until the page reloads.
  }
}

export function storedSort(): SortOrder {
  const stored = read(SORT_KEY);
  return isSortOrder(stored) ? stored : DEFAULT_SORT;
}

export const storeSort = (order: SortOrder): void => write(SORT_KEY, order);

export const storedDensity = (): boolean => read(DENSITY_KEY) === DENSE;

export const storeDensity = (isDense: boolean): void => write(DENSITY_KEY, isDense ? DENSE : COMFORTABLE);
