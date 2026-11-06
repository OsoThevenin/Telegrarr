import { useId, type ComponentProps } from "react";

import { Label } from "@/components/ui/label";

type Props = Omit<ComponentProps<"select">, "id" | "className"> & {
  label: string;
};

/** A labelled native select, which needs no help on a phone. */
export function SelectField({ label, children, ...select }: Props) {
  const id = useId();

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        className="h-9 w-full max-w-sm rounded-md border border-input bg-background px-2 text-sm"
        {...select}
      >
        {children}
      </select>
    </div>
  );
}
