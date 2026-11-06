import { useId, type ComponentProps } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/i18n/use-i18n";
import { cn } from "@/lib/utils";

type Props = Omit<ComponentProps<typeof Input>, "id"> & {
  label: string;
  hint?: string;
  /** Provided by an environment variable: it can be read here, not changed. */
  isEnvLocked?: boolean;
};

/** A labelled input whose hint is read out with it. */
export function TextField({ label, hint, isEnvLocked = false, className, ...input }: Props) {
  const { t } = useI18n();
  const id = useId();
  const hintId = `${id}-hint`;
  const description = isEnvLocked ? t("secret.env_locked") : hint;

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        aria-describedby={description ? hintId : undefined}
        className={cn(isEnvLocked && "bg-muted text-muted-foreground", className)}
        {...input}
        readOnly={isEnvLocked || input.readOnly}
      />
      {description && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {description}
        </p>
      )}
    </div>
  );
}
