import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { statusTone, type StatusTone } from "@/lib/status-tone";

/** A status pill toned like every other status in the app. */
export function ToneBadge({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return (
    <Badge variant="outline" data-tone={tone} className={statusTone(tone).badge}>
      {children}
    </Badge>
  );
}
