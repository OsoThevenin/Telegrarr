import { useMutation } from "@tanstack/react-query";

import { applyLanguage, LANGUAGES, type Language } from "@/i18n";
import { useI18n } from "@/i18n/use-i18n";
import { api } from "@/lib/api";

export function LanguageSwitch() {
  const { t, language, errorText } = useI18n();
  const saveLanguage = useMutation({
    mutationFn: async (next: Language) => {
      await api.patch("/api/settings", { ui_lang: next });
      await applyLanguage(next);
    },
  });

  return (
    <div className="flex flex-col gap-1 text-sm">
      <label className="flex items-center justify-between gap-2 text-muted-foreground">
        {t("set.language")}
        <select
          className="h-9 rounded-md border border-input bg-background px-2 text-foreground"
          value={language}
          onChange={(event) => saveLanguage.mutate(event.target.value as Language)}
        >
          {LANGUAGES.map(({ code, label }) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {saveLanguage.isError && (
        <p role="alert" className="text-destructive">
          {errorText(saveLanguage.error)}
        </p>
      )}
    </div>
  );
}
