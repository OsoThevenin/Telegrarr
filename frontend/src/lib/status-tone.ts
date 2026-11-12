/** How loudly a status reads, shared so a success, an error or a warning looks the same on every screen. */
export type StatusTone = "success" | "error" | "warning" | "neutral";

type ToneClasses = {
  /** A bordered pill: tinted fill, coloured text. */
  badge: string;
  /** A small solid marker. */
  dot: string;
  /** A faint wash for a whole row; empty when the status should not draw the eye. */
  row: string;
};

const TONES: Record<StatusTone, ToneClasses> = {
  success: {
    badge: "border-success/30 bg-success/10 text-success dark:bg-success/15",
    dot: "bg-success",
    row: "bg-success/5 dark:bg-success/[0.07]",
  },
  error: {
    badge: "border-destructive/25 bg-destructive/10 text-destructive dark:bg-destructive/15",
    dot: "bg-destructive",
    row: "bg-destructive/5 dark:bg-destructive/[0.07]",
  },
  warning: {
    badge: "border-warning/30 bg-warning/10 text-warning dark:bg-warning/15",
    dot: "bg-warning",
    row: "bg-warning/5 dark:bg-warning/[0.07]",
  },
  neutral: {
    badge: "border-border bg-muted text-muted-foreground",
    dot: "bg-muted-foreground/60",
    row: "",
  },
};

export function statusTone(tone: StatusTone): ToneClasses {
  return TONES[tone];
}
