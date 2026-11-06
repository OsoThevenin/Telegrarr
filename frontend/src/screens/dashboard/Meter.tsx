import { cn } from "@/lib/utils";
import type { MeterTone } from "@/screens/dashboard/dashboard-data";

const FILL_BY_TONE: Record<MeterTone, string> = {
  normal: "bg-primary",
  warning: "bg-amber-500",
  critical: "bg-destructive",
};

type Props = {
  label: string;
  /** From 0 to 1. */
  ratio: number;
  tone?: MeterTone;
};

export function Meter({ label, ratio, tone = "normal" }: Props) {
  const percent = Math.round(ratio * 100);

  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="h-1.5 overflow-hidden rounded-full bg-muted"
    >
      <div className={cn("h-full rounded-full transition-[width]", FILL_BY_TONE[tone])} style={{ width: `${percent}%` }} />
    </div>
  );
}
