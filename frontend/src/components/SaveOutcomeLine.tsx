import { StatusLine } from "@/components/StatusLine";
import { useI18n } from "@/i18n/use-i18n";
import type { SaveOutcome } from "@/lib/settings";

type Props = {
  outcome: SaveOutcome;
  savedText: string;
};

/** Says what a save really did, which is not always what was asked. */
export function SaveOutcomeLine({ outcome, savedText }: Props) {
  const { t, errorText } = useI18n();

  switch (outcome.kind) {
    case "idle":
      return null;
    case "saved":
      return <StatusLine tone="success">{savedText}</StatusLine>;
    case "adjusted":
      return <StatusLine tone="warning">{t("set.adjusted")}</StatusLine>;
    case "failed":
      return <StatusLine tone="error">{errorText(outcome.error)}</StatusLine>;
    default:
      return outcome satisfies never;
  }
}
