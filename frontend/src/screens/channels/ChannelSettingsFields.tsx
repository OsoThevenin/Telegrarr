import { useId, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/use-i18n";
import { kindChoiceLabel, type ChannelKind } from "@/screens/channels/channel";
import { POLL_FLOOR_MINUTES, WEEKDAY_NUMBERS, type SettingsForm } from "@/screens/channels/channel-settings";

const QUALITIES = [
  ["SDTV", "SDTV"],
  ["720p", "720p"],
  ["1080p", "1080p"],
  ["2160p", "2160p (4K)"],
];

export const FIELD_CLASS =
  "h-9 w-full min-w-0 text-ellipsis placeholder:text-ellipsis rounded-lg border border-input bg-card px-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60";

type FieldProps = {
  label: string;
  /** A line under the control; the control names `id` as its description. */
  hint?: { id: string; text: string };
  children: ReactNode;
};

export function Field({ label, hint, children }: FieldProps) {
  const field = (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="font-medium">{label}</span>
      {children}
    </label>
  );
  if (!hint) return field;

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {field}
      <p id={hint.id} className="text-xs text-muted-foreground">
        {hint.text}
      </p>
    </div>
  );
}

type Option = { value: string; label: string };

type SelectFieldProps = {
  label: string;
  hint?: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
};

function SelectField({ label, hint, value, options, onChange }: SelectFieldProps) {
  const hintId = useId();

  return (
    <Field label={label} hint={hint ? { id: hintId, text: hint } : undefined}>
      <select
        className={FIELD_CLASS}
        aria-describedby={hint ? hintId : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

type Props = {
  form: SettingsForm;
  /** Empty leaves the kind out, for the forum topics that each choose their own. */
  kinds: ChannelKind[];
  onChange: (form: SettingsForm) => void;
};

/** The settings every source has: the short ones side by side where there is room, then the days. */
export function ChannelSettingsFields({ form, kinds, onChange }: Props) {
  const { t } = useI18n();
  const languages = [
    { value: "cat", label: `${t("chm.lang.cat")} (CAT)` },
    { value: "es", label: `${t("chm.lang.es")} (SPA)` },
    { value: "en", label: `${t("chm.lang.en")} (ENG)` },
    { value: "multi", label: `${t("chm.lang.multi")} (MULTI)` },
  ];

  return (
    <>
      <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2">
        {kinds.length > 0 && (
          <SelectField
            label={t("chm.kind")}
            value={form.kind}
            options={kinds.map((kind) => ({ value: kind, label: kindChoiceLabel(kind, t) }))}
            onChange={(kind) => onChange({ ...form, kind })}
          />
        )}
        <SelectField
          label={t("chm.audio_language")}
          value={form.language}
          options={languages}
          onChange={(language) => onChange({ ...form, language })}
        />
        <SelectField
          label={t("chm.fallback_quality")}
          hint={t("chm.fallback_quality_hint")}
          value={form.fallback_quality}
          options={QUALITIES.map(([value, label]) => ({ value, label }))}
          onChange={(fallback_quality) => onChange({ ...form, fallback_quality })}
        />
        <Field label={t("chm.poll")}>
          <input
            className={FIELD_CLASS}
            type="number"
            required
            min={POLL_FLOOR_MINUTES}
            value={form.poll}
            onChange={(event) => onChange({ ...form, poll: event.target.value })}
          />
        </Field>
      </div>
      <DayPicker days={form.days} onChange={(days) => onChange({ ...form, days })} />
    </>
  );
}

function DayPicker({ days, onChange }: { days: number[]; onChange: (days: number[]) => void }) {
  const { t } = useI18n();
  const names = t("common.weekdays_short").split(" ");
  const toggle = (day: number) => onChange(days.includes(day) ? days.filter((other) => other !== day) : [...days, day]);

  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="pb-1.5 font-medium">{t("chm.scan_days")}</legend>
      <div className="flex flex-wrap gap-1">
        {WEEKDAY_NUMBERS.map((day) => (
          <Button
            key={day}
            type="button"
            size="icon-lg"
            variant={days.includes(day) ? "default" : "outline"}
            aria-pressed={days.includes(day)}
            onClick={() => toggle(day)}
          >
            {names[day]}
          </Button>
        ))}
      </div>
    </fieldset>
  );
}
