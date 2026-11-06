import { useId, type ComponentProps } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = Omit<ComponentProps<typeof Input>, "id"> & {
  label: string;
  hint?: string;
};

/** A labelled input whose hint is read out with it. */
export function TextField({ label, hint, ...input }: Props) {
  const id = useId();
  const hintId = `${id}-hint`;

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} aria-describedby={hint ? hintId : undefined} {...input} />
      {hint && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}
