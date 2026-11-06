import { useState, type FormEvent } from "react";

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
import { ChannelSettingsFields, Field, FIELD_CLASS } from "@/screens/channels/ChannelSettingsFields";
import { SeriesMapper } from "@/screens/channels/SeriesMapper";
import { isSeriesKind, MOVIE_KIND, sourceLabel, type Channel } from "@/screens/channels/channel";
import { formOf, kindsFor, settingsOf } from "@/screens/channels/channel-settings";
import { useUpdateChannel } from "@/screens/channels/queries";
import { useSeriesMapping } from "@/screens/channels/use-series-mapping";

type Props = {
  source: Channel;
  isOpen: boolean;
  onSaved: () => void;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
};

/** One source's settings. */
export function ChannelEditDialog({ source, isOpen, onSaved, onClose, onCloseAutoFocus }: Props) {
  const { t } = useI18n();

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>{t("ch.edit_aria")}</DialogTitle>
        </DialogHeader>
        <EditForm source={source} onSaved={onSaved} />
      </DialogContent>
    </Dialog>
  );
}

/** Mounted with the dialog's content, so each opening starts from the source as it is. */
function EditForm({ source, onSaved }: Pick<Props, "source" | "onSaved">) {
  const { t, errorText } = useI18n();
  const [form, setForm] = useState(() => formOf(source));
  const update = useUpdateChannel();
  const series = useSeriesMapping(source);
  const isSeries = isSeriesKind(form.kind);

  const save = (event: FormEvent) => {
    event.preventDefault();
    const mapping = isSeries ? series.payload : null;
    update.mutate({ id: source.id, fields: settingsOf(form), mapping }, { onSuccess: onSaved });
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={save}>
      <Field label={t("chm.tg_channel")}>
        <input className={FIELD_CLASS} value={sourceLabel(source)} disabled />
      </Field>
      <ChannelSettingsFields form={form} kinds={kindsFor(source)} onChange={setForm} />
      {isSeries && <SeriesMapper mapping={series} source={source} />}
      {form.kind === MOVIE_KIND && <p className="text-muted-foreground">{t("chm.movie_note")}</p>}
      {update.isError && (
        <p role="alert" className="text-destructive">
          {errorText(update.error)}
        </p>
      )}
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            {t("common.cancel")}
          </Button>
        </DialogClose>
        <Button type="submit" disabled={update.isPending}>
          {update.isPending ? t("common.saving") : t("common.save")}
        </Button>
      </DialogFooter>
    </form>
  );
}
