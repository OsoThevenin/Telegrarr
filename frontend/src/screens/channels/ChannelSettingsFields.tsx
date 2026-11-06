import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/use-i18n";
import { kindChoiceLabel } from "@/screens/channels/channel";
import { POLL_FLOOR_MINUTES, WEEKDAY_NUMBERS, type SettingsForm } from "@/screens/channels/channel-settings";

const QUALITIES = [
  ["SDTV", "SDTV"],
  ["720p", "720p"],
  ["1080p", "1080p"],
  ["2160p", "2160p (4K)"],
];

export const FIELD_CLASS =
  "h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-medium">{label}</span>
      {children}
    </label>
  );
}

type Option = { value: string; label: string };

type SelectFieldProps = {
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
};

function SelectField({ label, value, options, onChange }: SelectFieldProps) {
  return (
    <Field label={label}>
      <select className={FIELD_CLASS} value={value} onChange={(event) => onChange(event.target.value)}>
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
  kinds: string[];
  onChange: (form: SettingsForm) => void;
};

/** The settings every source has. */
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
        value={form.fallback_quality}
        options={QUALITIES.map(([value, label]) => ({ value, label }))}
        onChange={(fallback_quality) => onChange({ ...form, fallback_quality })}
      />
      <DayPicker days={form.days} onChange={(days) => onChange({ ...form, days })} />
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
    </>
  );
}

function DayPicker({ days, onChange }: { days: number[]; onChange: (days: number[]) => void }) {
  const { t } = useI18n();
  const names = t("common.weekdays_short").split(" ");
  const toggle = (day: number) =>
    onChange(days.includes(day) ? days.filter((other) => other !== day) : [...days, day]);

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
