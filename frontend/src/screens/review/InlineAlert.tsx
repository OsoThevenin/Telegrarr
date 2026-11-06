import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

type Props = {
  children: ReactNode;
  actionLabel: string;
  onAction: () => void;
};

export function InlineAlert({ children, actionLabel, onAction }: Props) {
  return (
    <div
      role="alert"
      className="flex items-start justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
    >
      <div className="min-w-0">{children}</div>
      <Button type="button" variant="outline" size="sm" onClick={onAction}>
        {actionLabel}
      </Button>
    </div>
  );
}
