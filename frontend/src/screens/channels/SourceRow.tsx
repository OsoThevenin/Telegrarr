import { useId, useState } from "react";

import { Trash2Icon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/i18n/use-i18n";
import { HistoryProgress } from "@/screens/channels/HistoryProgress";
import { isWholeForum, scheduleLabel, sourceLabel, type Channel } from "@/screens/channels/channel";
import type { ChannelControls } from "@/screens/channels/channel-controls";

type Props = {
  source: Channel;
  isOnlySource: boolean;
  controls: ChannelControls;
};

type ScanningSwitchProps = {
  source: Channel;
  /** The element that names the source. */
  describedBy: string;
  controls: ChannelControls;
};

/** Shows the change at once, and goes back to what the server says once that has settled. */
function ScanningSwitch({ source, describedBy, controls }: ScanningSwitchProps) {
  const { t } = useI18n();
  const switchId = useId();
  const [requested, setRequested] = useState<boolean | null>(null);

  const change = async (isScanning: boolean) => {
    if (requested !== null) return;
    setRequested(isScanning);
    await controls.actions.setScanning(source, isScanning);
    setRequested(null);
  };

  return (
    <div className="flex basis-full items-center justify-between gap-2 border-t pt-2">
      <Label htmlFor={switchId}>{t("ch.scanning")}</Label>
      <Switch
        id={switchId}
        aria-describedby={describedBy}
        checked={requested ?? Boolean(source.scanning)}
        onCheckedChange={(isScanning) => void change(isScanning)}
      />
    </div>
  );
}

/** One source of a show. */
export function SourceRow({ source, isOnlySource, controls }: Props) {
  const { t } = useI18n();
  const labelId = useId();
  const label = sourceLabel(source);
  const isEnabled = Boolean(source.enabled);
  const detail = [
    t(isEnabled ? "common.enabled" : "common.disabled"),
    scheduleLabel(source, t),
    isWholeForum(source) && t("ch.forum_whole_short"),
  ].filter(Boolean);

  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border p-2">
      <span className="min-w-0 flex-1 basis-40">
        <span id={labelId} className="block truncate font-medium" title={label}>
          {label}
        </span>
        <span className="block truncate text-xs text-muted-foreground">{detail.join(" · ")}</span>
        {!source.scanning && (
          <Badge variant="secondary" className="mt-1">
            {t("ch.scanning_stopped")}
          </Badge>
        )}
      </span>
      <div className="flex items-center">
        <Button
          variant="ghost"
          aria-describedby={labelId}
          onClick={() => controls.actions.setEnabled([source], !isEnabled)}
        >
          {t(isEnabled ? "common.disable" : "common.enable")}
        </Button>
        <Button
          variant="ghost"
          aria-describedby={labelId}
          onClick={(event) => controls.editSource(source, event.currentTarget)}
        >
          {t("common.edit")}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("ch.remove_aria")}
          aria-describedby={labelId}
          onClick={(event) => controls.askToRemove({ source, isWholeShow: isOnlySource }, event.currentTarget)}
        >
          <Trash2Icon />
        </Button>
      </div>
      <ScanningSwitch source={source} describedBy={labelId} controls={controls} />
      <HistoryProgress history={source.history} />
    </li>
  );
}
