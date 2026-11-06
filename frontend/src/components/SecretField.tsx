import { useId, useState } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/i18n/use-i18n";

/** What the backend says about a secret. It never sends the value itself. */
export type SecretState = { kind: "empty" } | { kind: "saved"; preview?: string };

const MASK = "••••";

type Props = {
  label: string;
  state: SecretState;
  /** The value being typed; null while the saved one stands. The form owns it. */
  draft: string | null;
  onDraftChange: (draft: string | null) => void;
  /** Rejecting leaves the confirmation open with the reason. */
  onClear: () => Promise<void>;
  placeholder?: string;
  hint?: string;
};

/** The one way to show and edit a secret: it is never read back, only replaced or cleared. */
export function SecretField({ label, state, draft, onDraftChange, ...rest }: Props) {
  switch (state.kind) {
    case "empty":
      return <SecretInput label={label} draft={draft} onDraftChange={onDraftChange} {...rest} />;
    case "saved":
      return draft === null ? (
        <SavedSecret label={label} preview={state.preview} onReplace={() => onDraftChange("")} {...rest} />
      ) : (
        <SecretInput label={label} draft={draft} onDraftChange={onDraftChange} isReplacing {...rest} />
      );
    default:
      return state satisfies never;
  }
}

type SavedSecretProps = Pick<Props, "label" | "onClear" | "hint"> & {
  preview: string | undefined;
  onReplace: () => void;
};

function SavedSecret({ label, preview, onClear, onReplace, hint }: SavedSecretProps) {
  const { t } = useI18n();
  const [isConfirming, setIsConfirming] = useState(false);

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Badge variant="secondary" className="h-auto max-w-full font-mono whitespace-normal break-all">
          {t("secret.saved", { preview: preview ?? MASK })}
        </Badge>
        <Button type="button" variant="outline" size="sm" aria-label={t("secret.replace_label", { label })} onClick={onReplace}>
          {t("secret.replace")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={t("secret.clear_label", { label })}
          onClick={() => setIsConfirming(true)}
        >
          {t("common.clear")}
        </Button>
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <ConfirmDialog
        isOpen={isConfirming}
        onOpenChange={setIsConfirming}
        title={t("secret.clear_title", { label })}
        description={t("secret.clear_body")}
        confirmLabel={t("common.clear")}
        onConfirm={onClear}
        isDestructive
      />
    </div>
  );
}

type SecretInputProps = Pick<Props, "label" | "draft" | "onDraftChange" | "placeholder" | "hint"> & {
  isReplacing?: boolean;
};

function SecretInput({ label, draft, onDraftChange, placeholder, hint, isReplacing = false }: SecretInputProps) {
  const { t } = useI18n();
  const id = useId();
  const hintId = `${id}-hint`;

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex min-w-0 items-center gap-2">
        <Input
          id={id}
          type="password"
          autoComplete="off"
          autoFocus={isReplacing}
          spellCheck={false}
          placeholder={placeholder}
          aria-describedby={hint ? hintId : undefined}
          value={draft ?? ""}
          onChange={(event) => onDraftChange(event.target.value)}
        />
        {isReplacing && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onDraftChange(null)}>
            {t("secret.keep")}
          </Button>
        )}
      </div>
      {hint && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

/** What a form sends for a secret: a blank draft keeps the saved value instead of clearing it. */
export function secretPatch(key: string, draft: string | null): Record<string, string> {
  const value = draft?.trim();
  return value ? { [key]: value } : {};
}
