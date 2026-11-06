import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type StatusTone = "neutral" | "success" | "warning" | "error";

const TONE_CLASSES: Record<StatusTone, string> = {
  neutral: "text-muted-foreground",
  success: "text-foreground",
  warning: "text-foreground",
  error: "text-destructive",
};

const TONE_MARKS: Record<StatusTone, string> = {
  neutral: "",
  success: "✓ ",
  warning: "! ",
  error: "✕ ",
};

type Props = {
  tone: StatusTone;
  children: ReactNode;
};

/** The outcome of an action, beside it. The mark keeps the meaning without colour. */
export function StatusLine({ tone, children }: Props) {
  return (
    <p role={tone === "error" ? "alert" : "status"} className={cn("text-sm break-words", TONE_CLASSES[tone])}>
      <span aria-hidden="true">{TONE_MARKS[tone]}</span>
      {children}
    </p>
  );
}
