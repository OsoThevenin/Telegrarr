import type { ReactNode } from "react";

import { Check, TriangleAlert, X, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export type StatusTone = "neutral" | "success" | "warning" | "error";

const TONE_CLASSES: Record<StatusTone, string> = {
  neutral: "text-muted-foreground",
  success: "text-foreground",
  warning: "text-warning",
  error: "text-destructive",
};

type ToneMark = {
  Icon: LucideIcon;
  className: string;
};

const TONE_MARKS: Record<StatusTone, ToneMark | null> = {
  neutral: null,
  success: { Icon: Check, className: "text-success" },
  warning: { Icon: TriangleAlert, className: "text-warning" },
  error: { Icon: X, className: "text-destructive" },
};

type Props = {
  tone: StatusTone;
  children: ReactNode;
};

/** The outcome of an action, beside it. The mark keeps the meaning without colour. */
export function StatusLine({ tone, children }: Props) {
  const mark = TONE_MARKS[tone];

  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      data-tone={tone}
      className={cn("flex items-start gap-1.5 text-sm break-words", TONE_CLASSES[tone])}
    >
      {mark && <mark.Icon aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", mark.className)} />}
      <span className="min-w-0">{children}</span>
    </p>
  );
}
