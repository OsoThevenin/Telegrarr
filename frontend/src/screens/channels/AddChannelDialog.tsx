import { useRef, useState, type FormEvent, type RefObject } from "react";

import { useNavigate, useSearch } from "@tanstack/react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/i18n/use-i18n";
import { ChannelSettingsFields } from "@/screens/channels/ChannelSettingsFields";
import { EntityPicker } from "@/screens/channels/EntityPicker";
import { useAddChannel } from "@/screens/channels/add-channel";
import type { Channel } from "@/screens/channels/channel";
import { NEW_CHANNEL_FORM, NEW_CHANNEL_KINDS, settingsOf } from "@/screens/channels/channel-settings";
import type { PickedChat } from "@/screens/channels/telegram-queries";

type Props = {
  /** Where focus goes when what opened the dialog is gone, as the palette is. */
  focusFallback: RefObject<HTMLElement | null>;
  onAdded: (rows: Channel[]) => void;
};

/** Open while the URL says so: the top bar, the empty list and the palette all link to it. */
export function AddChannelDialog({ focusFallback, onAdded }: Props) {
  const { t } = useI18n();
  const { add } = useSearch({ from: "/channels" });
  const navigate = useNavigate();
  const opener = useRef<HTMLElement | null>(null);

  const close = () => void navigate({ to: "/channels", search: {}, replace: true });

  const rememberOpener = () => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  };

  const restoreFocus = (event: Event) => {
    event.preventDefault();
    const element = opener.current?.isConnected ? opener.current : focusFallback.current;
    element?.focus();
  };

  const finish = (rows: Channel[]) => {
    onAdded(rows);
    close();
  };

  return (
    <Dialog open={Boolean(add)} onOpenChange={(open) => !open && close()}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md"
        onOpenAutoFocus={rememberOpener}
        onCloseAutoFocus={restoreFocus}
      >
        <DialogHeader>
          <DialogTitle>{t("shell.add_channel")}</DialogTitle>
        </DialogHeader>
        <AddForm onFinished={finish} />
      </DialogContent>
    </Dialog>
  );
}

/** Mounted with the dialog's content, so each opening starts blank. */
function AddForm({ onFinished }: { onFinished: (rows: Channel[]) => void }) {
  const { t, errorText } = useI18n();
  const [chat, setChat] = useState<PickedChat | null>(null);
  const [form, setForm] = useState(NEW_CHANNEL_FORM);
  const [problems, setProblems] = useState<string[]>([]);
  const add = useAddChannel();

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!chat) {
      setProblems([t("chm.pick_first")]);
      return;
    }

    setProblems([]);
    add.mutate(
      { chat, settings: settingsOf(form), targets: [{ kind: form.kind }] },
      {
        onSuccess: ({ added, failures }) => {
          setProblems(failures.map(({ error }) => errorText(error)));
          if (added.length > 0) toast.success(t("chm.added"));
          if (failures.length === 0) onFinished(added);
        },
      },
    );
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={save}>
      <EntityPicker selected={chat} onSelect={setChat} />
      <ChannelSettingsFields form={form} kinds={NEW_CHANNEL_KINDS} onChange={setForm} />
      {problems.map((problem) => (
        <p key={problem} role="alert" className="text-destructive">
          {problem}
        </p>
      ))}
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            {t("common.cancel")}
          </Button>
        </DialogClose>
        <Button type="submit" disabled={add.isPending}>
          {t(add.isPending ? "common.saving" : "common.save")}
        </Button>
      </DialogFooter>
    </form>
  );
}
