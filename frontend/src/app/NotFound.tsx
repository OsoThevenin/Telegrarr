import { Link } from "@tanstack/react-router";

import { useI18n } from "@/i18n/use-i18n";

export function NotFound() {
  const { t } = useI18n();

  return (
    <div className="flex flex-col items-start gap-2">
      <p>{t("shell.not_found")}</p>
      <Link to="/" className="text-primary underline-offset-4 hover:underline">
        {t("shell.back_to_dashboard")}
      </Link>
    </div>
  );
}
