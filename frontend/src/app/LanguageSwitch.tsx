import { useMutation } from "@tanstack/react-query";
import { ChevronsUpDown, Languages } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { applyLanguage, LANGUAGES, type Language } from "@/i18n";
import { useI18n } from "@/i18n/use-i18n";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

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
      {/* A row like its neighbours; the native select keeps the keyboard and screen readers. */}
      <label
        className={cn(
          buttonVariants({ variant: "sidebar", size: "lg" }),
          "relative cursor-pointer focus-within:ring-3 focus-within:ring-ring/50",
        )}
      >
        <Languages aria-hidden="true" />
        <span className="flex-1">{t("set.language")}</span>
        <select
          className="cursor-pointer appearance-none bg-transparent pr-5 text-right text-foreground outline-none"
          value={language}
          onChange={(event) => saveLanguage.mutate(event.target.value as Language)}
        >
          {LANGUAGES.map(({ code, label }) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
        </select>
        <ChevronsUpDown aria-hidden="true" className="pointer-events-none absolute right-3 size-3.5!" />
      </label>
      {saveLanguage.isError && (
        <p role="alert" className="px-3 text-destructive">
          {errorText(saveLanguage.error)}
        </p>
      )}
    </div>
  );
}
