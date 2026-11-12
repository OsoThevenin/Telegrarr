import { useEffect, useState } from "react";

export const TYPING_DEBOUNCE_MS = 350;

/** `value` once it has stopped changing for `delayMs`. */
export function useDebounced<T>(value: T, delayMs: number = TYPING_DEBOUNCE_MS): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
