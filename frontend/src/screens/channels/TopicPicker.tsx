import { useI18n } from "@/i18n/use-i18n";
import { FIELD_CLASS } from "@/screens/channels/ChannelSettingsFields";
import { kindChoiceLabel } from "@/screens/channels/channel";
import { NEW_CHANNEL_FORM, NEW_CHANNEL_KINDS } from "@/screens/channels/channel-settings";
import type { ForumTopic } from "@/screens/channels/telegram-queries";

/** The ticked topics and the kind each is added as. */
export type TopicTicks = Record<number, string>;

type Props = {
  topics: ForumTopic[];
  ticks: TopicTicks;
  onChange: (ticks: TopicTicks) => void;
};

const untick = (ticks: TopicTicks, topicId: number): TopicTicks =>
  Object.fromEntries(Object.entries(ticks).filter(([id]) => Number(id) !== topicId));

/** A forum group's topics: each ticked one becomes a source of its own, with its own kind. */
export function TopicPicker({ topics, ticks, onChange }: Props) {
  const { t } = useI18n();

  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="pb-1.5 font-medium">{t("chm.topics.title")}</legend>
      <p className="text-muted-foreground">{topics.length > 0 ? t("chm.topics.hint") : t("chm.topics.empty")}</p>
      {topics.map(({ topic_id, title }) => {
        const kind = ticks[topic_id];

        return (
          <div key={topic_id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-2">
            <label className="flex min-w-0 items-center gap-2">
              <input
                type="checkbox"
                checked={kind !== undefined}
                onChange={({ target }) =>
                  onChange(target.checked ? { ...ticks, [topic_id]: NEW_CHANNEL_FORM.kind } : untick(ticks, topic_id))
                }
              />
              <span className="truncate">{title}</span>
            </label>
            <select
              className={FIELD_CLASS}
              aria-label={t("chm.topics.kind_aria", { topic: title })}
              disabled={kind === undefined}
              value={kind ?? NEW_CHANNEL_FORM.kind}
              onChange={(event) => onChange({ ...ticks, [topic_id]: event.target.value })}
            >
              {NEW_CHANNEL_KINDS.map((option) => (
                <option key={option} value={option}>
                  {kindChoiceLabel(option, t)}
                </option>
              ))}
            </select>
          </div>
        );
      })}
    </fieldset>
  );
}
