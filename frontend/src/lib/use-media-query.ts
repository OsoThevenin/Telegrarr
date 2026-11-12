import { useSyncExternalStore } from "react";

/** Whether a CSS media query matches now; follows the viewport as it changes. */
export function useMediaQuery(query: string): boolean {
  const subscribe = (onChange: () => void) => {
    const list = window.matchMedia(query);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  };
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}

/** Below Tailwind's `sm` and `lg` breakpoints: a phone, and a screen too narrow for a table beside the sidebar. */
export const PHONE_QUERY = "(max-width: 639px)";
export const NARROW_QUERY = "(max-width: 1023px)";
