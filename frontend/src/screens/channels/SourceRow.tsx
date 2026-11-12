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

type SourceSwitchProps = {
  label: string;
  hint: string;
  isOn: boolean;
  /** The element that names the source. */
  describedBy: string;
  onChange: (isOn: boolean) => Promise<unknown>;
};

/** Shows the change at once, and goes back to what the server says once that has settled. */
function SourceSwitch({ label, hint, isOn, describedBy, onChange }: SourceSwitchProps) {
  const switchId = useId();
  const hintId = useId();
  const [requested, setRequested] = useState<boolean | null>(null);

  const change = async (next: boolean) => {
    if (requested !== null) return;
    setRequested(next);
    await onChange(next);
    setRequested(null);
  };

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <Label htmlFor={switchId}>{label}</Label>
        <span id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </span>
      </div>
      <Switch
        id={switchId}
        aria-describedby={`${hintId} ${describedBy}`}
        checked={requested ?? isOn}
        onCheckedChange={(next) => void change(next)}
      />
    </div>
  );
}

/** One source of a show. */
export function SourceRow({ source, isOnlySource, controls }: Props) {
  const { t } = useI18n();
  const labelId = useId();
  const label = sourceLabel(source);
  const detail = [scheduleLabel(source, t), isWholeForum(source) && t("ch.forum_whole_short")].filter(Boolean);
  const { actions } = controls;

  return (
    <li className="flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1">
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
        <div className="flex shrink-0 items-center">
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
      </div>
      <div className="flex flex-col gap-3 border-t pt-3">
        <SourceSwitch
          label={t("common.enabled")}
          hint={t("ch.enabled_hint")}
          isOn={Boolean(source.enabled)}
          describedBy={labelId}
          onChange={(isEnabled) => actions.setEnabled([source], isEnabled)}
        />
        <SourceSwitch
          label={t("ch.scanning")}
          hint={t("ch.scanning_hint")}
          isOn={Boolean(source.scanning)}
          describedBy={labelId}
          onChange={(isScanning) => actions.setScanning(source, isScanning)}
        />
      </div>
      <HistoryProgress history={source.history} />
    </li>
  );
}
