import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useI18n } from "@/i18n/use-i18n";
import { sourceLabel, type Channel } from "@/screens/channels/channel";

export type Removal = {
  source: Channel;
  /** Whether the source is all there is to its show, so the show goes with it. */
  isWholeShow: boolean;
};

type Props = {
  removal: Removal;
  isOpen: boolean;
  onConfirm: () => void;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
};

export function RemoveDialog({ removal, isOpen, onConfirm, onClose, onCloseAutoFocus }: Props) {
  const { t } = useI18n();
  const { source } = removal;

  return (
    <AlertDialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("ch.remove_aria")}</AlertDialogTitle>
          <AlertDialogDescription>
            <span className="block font-medium text-foreground">{sourceLabel(source)}</span>
            {t("ch.remove_confirm")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            {t("common.remove")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
