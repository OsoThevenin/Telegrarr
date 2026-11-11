import { useState, type FormEvent } from "react";

import { Dialog } from "@/components/ui/dialog";
import { useI18n } from "@/i18n/use-i18n";
import { ChannelDialogContent, ChannelForm } from "@/screens/channels/ChannelFormDialog";
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
      <ChannelDialogContent title={t("ch.edit_aria")} onCloseAutoFocus={onCloseAutoFocus}>
        <EditForm source={source} onSaved={onSaved} />
      </ChannelDialogContent>
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
    <ChannelForm onSubmit={save} isSaving={update.isPending} canSave={!update.isPending}>
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
    </ChannelForm>
  );
}
