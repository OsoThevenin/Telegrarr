import type { ReactNode } from "react";

type Props = {
  rows: readonly (readonly [label: string, value: ReactNode])[];
};

export function InfoGrid({ rows }: Props) {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="font-mono break-all tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
