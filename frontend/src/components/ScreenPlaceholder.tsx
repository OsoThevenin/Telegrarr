import { useTranslation } from "react-i18next";

/** Stands in for a screen until its own ticket replaces it. */
export function ScreenPlaceholder() {
  const { t } = useTranslation();

  return <p className="text-muted-foreground">{t("shell.placeholder")}</p>;
}
