import { useNavigate } from "@tanstack/react-router";
import { History, LogOut, Pause, Play, Plus, ScanSearch, SunMoon, type LucideIcon } from "lucide-react";
import { toast } from "sonner";

import { NAV_ITEMS } from "@/app/navigation";
import { useQueuePause } from "@/app/use-queue-pause";
import { useI18n } from "@/i18n/use-i18n";
import { api, type ServerMessage } from "@/lib/api";
import { goToLogout } from "@/lib/browser";
import { cycleTheme } from "@/lib/theme";

export type PaletteCommand = {
  label: string;
  icon: LucideIcon;
  /** What kind of command this is; also matches when typing it. */
  hint?: string;
  run: () => void;
};

/** Asks for every channel, so one failure does not stop the rest. */
async function backfillAllChannels(): Promise<void> {
  const channels = await api.get<{ id: number }[]>("/api/channels");
  const results = await Promise.allSettled(channels.map(({ id }) => api.post(`/api/channels/${id}/backfill`)));
  const failure = results.find((result) => result.status === "rejected");
  if (failure) throw failure.reason;
}

export function usePaletteCommands(): readonly PaletteCommand[] {
  const { t, msg, errorText } = useI18n();
  const navigate = useNavigate();
  const { isPaused, toggle } = useQueuePause();

  const showFailure = (error: unknown) => toast.error(errorText(error));

  const screens = NAV_ITEMS.map<PaletteCommand>(({ to, labelKey, icon }) => ({
    label: t("cmd.go_to", { view: t(labelKey) }),
    icon,
    hint: t("cmd.hint_view"),
    run: () => void navigate({ to }),
  }));

  const pause: PaletteCommand[] =
    isPaused === undefined
      ? []
      : [{ label: t(isPaused ? "shell.resume" : "shell.pause"), icon: isPaused ? Play : Pause, run: toggle }];

  return [
    ...screens,
    { label: t("shell.add_channel"), icon: Plus, run: () => void navigate({ to: "/channels" }) },
    ...pause,
    {
      label: t("cmd.scan_all"),
      icon: ScanSearch,
      run: () => {
        api
          .post<{ message: ServerMessage }>("/api/system/tasks/scan_all")
          .then(({ message }) => toast.success(msg(message)))
          .catch(showFailure);
      },
    },
    {
      label: t("cmd.backfill_all"),
      icon: History,
      run: () => {
        backfillAllChannels()
          .then(() => toast.success(t("ch.backfill_started")))
          .catch(showFailure);
      },
    },
    { label: t("cmd.toggle_theme"), icon: SunMoon, run: cycleTheme },
    { label: t("shell.sign_out"), icon: LogOut, run: goToLogout },
  ];
}
