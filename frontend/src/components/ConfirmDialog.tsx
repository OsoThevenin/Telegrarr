import { useState, type ReactNode } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { StatusLine } from "@/components/StatusLine";
import { useI18n } from "@/i18n/use-i18n";

type Props = {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  /** Rejecting keeps the dialog open and shows why. */
  onConfirm: () => Promise<void>;
  isDestructive?: boolean;
  /** Sits beside the title, as the Experimental badge does. */
  badge?: ReactNode;
};

/** Asks before something consequential, and stays open until it has really happened. */
export function ConfirmDialog({ isOpen, onOpenChange, title, ...content }: Props) {
  return (
    <AlertDialog open={isOpen} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <ConfirmContent title={title} onDone={() => onOpenChange(false)} {...content} />
      </AlertDialogContent>
    </AlertDialog>
  );
}

type ContentProps = Omit<Props, "isOpen" | "onOpenChange"> & { onDone: () => void };

type TriggeredProps = Omit<ContentProps, "onDone"> & {
  /** The button that asks; it should say what it does, and gets the focus back on closing. */
  trigger: ReactNode;
};

/** A ConfirmDialog that opens from its own button. */
export function ConfirmTrigger({ trigger, ...content }: TriggeredProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <AlertDialog open={isOpen} onOpenChange={setIsOpen}>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <ConfirmContent onDone={() => setIsOpen(false)} {...content} />
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Mounted only while the dialog is open, so a reopened dialog has no old error. */
function ConfirmContent({ title, description, confirmLabel, onConfirm, isDestructive, badge, onDone }: ContentProps) {
  const { t, errorText } = useI18n();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function handleConfirm() {
    setIsPending(true);
    setError(null);
    try {
      await onConfirm();
      onDone();
    } catch (reason) {
      setError(reason);
      setIsPending(false);
    }
  }

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        {badge}
        <AlertDialogDescription>{description}</AlertDialogDescription>
      </AlertDialogHeader>
      {error !== null && <StatusLine tone="error">{errorText(error)}</StatusLine>}
      <AlertDialogFooter>
        <AlertDialogCancel disabled={isPending}>{t("common.cancel")}</AlertDialogCancel>
        <AlertDialogAction
          variant={isDestructive ? "destructive" : "default"}
          disabled={isPending}
          onClick={(event) => {
            // The dialog closes itself on click; here it closes only once this worked.
            event.preventDefault();
            void handleConfirm();
          }}
        >
          {confirmLabel}
        </AlertDialogAction>
      </AlertDialogFooter>
    </>
  );
}
