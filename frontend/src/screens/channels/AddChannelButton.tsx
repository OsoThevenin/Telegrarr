import { useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/use-i18n";

/** On a phone the top bar has no room for the words, so the icon stands alone there. */
export function AddChannelButton() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const label = t("shell.add_channel");

  return (
    <Button aria-label={label} onClick={() => void navigate({ to: "/channels", search: { add: true } })}>
      <Plus aria-hidden />
      <span className="hidden sm:inline">{label}</span>
    </Button>
  );
}
