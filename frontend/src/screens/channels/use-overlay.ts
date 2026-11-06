import { useRef, useState, type RefObject } from "react";

export type Opener = HTMLElement | null;

/**
 * An overlay opened for a target. The target outlives closing, so the closing animation still
 * has content. Focus goes back to whatever opened it, or to `fallback` when the action taken
 * inside removed that: Radix only knows its own triggers, and these overlays have none.
 */
export function useOverlay<Target>(fallback: RefObject<HTMLElement | null>) {
  const [target, setTarget] = useState<Target | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const opener = useRef<Opener>(null);

  return {
    target,
    isOpen,
    open: (nextTarget: Target, nextOpener: Opener) => {
      opener.current = nextOpener;
      setTarget(nextTarget);
      setIsOpen(true);
    },
    close: () => setIsOpen(false),
    onCloseAutoFocus: (event: Event) => {
      event.preventDefault();
      const element = opener.current?.isConnected ? opener.current : fallback.current;
      element?.focus();
    },
  };
}
