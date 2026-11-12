import type { ComponentProps, FormEvent, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/i18n/use-i18n";
import { cn } from "@/lib/utils";

type ContentProps = Omit<ComponentProps<typeof DialogContent>, "title" | "closeLabel"> & { title: string };

/**
 * A channel form's frame: never taller than the screen, with the title and its X fixed on top.
 * The form below keeps its actions fixed at the bottom and scrolls only what lies between.
 */
export function ChannelDialogContent({ title, className, children, ...props }: ContentProps) {
  const { t } = useI18n();

  return (
    <DialogContent
      closeLabel={t("common.close")}
      aria-describedby={undefined}
      className={cn("flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg", className)}
      {...props}
    >
      <DialogHeader className="shrink-0 p-4 pr-12">
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      {children}
    </DialogContent>
  );
}

type FormProps = {
  onSubmit: (event: FormEvent) => void;
  isSaving: boolean;
  canSave: boolean;
  children: ReactNode;
};

/** The fields scroll; Cancel and Save stay in sight. */
export function ChannelForm({ onSubmit, isSaving, canSave, children }: FormProps) {
  const { t } = useI18n();

  return (
    <form className="flex min-h-0 min-w-0 flex-1 flex-col" onSubmit={onSubmit}>
      <div data-slot="dialog-body" className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
        {children}
      </div>
      <DialogFooter className="m-0 shrink-0">
        <DialogClose asChild>
          <Button type="button" variant="outline">
            {t("common.cancel")}
          </Button>
        </DialogClose>
        <Button type="submit" disabled={!canSave}>
          {isSaving ? t("common.saving") : t("common.save")}
        </Button>
      </DialogFooter>
    </form>
  );
}
