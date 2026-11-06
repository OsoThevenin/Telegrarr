import { useId } from "react";

import { Trash2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/use-i18n";
import { isWholeForum, scheduleLabel, sourceLabel, type Channel } from "@/screens/channels/channel";
import type { ChannelControls } from "@/screens/channels/channel-controls";

type Props = {
  source: Channel;
  isOnlySource: boolean;
  controls: ChannelControls;
};

/** One source of a show. #70 adds its scanning switch and history progress here. */
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
          aria-label={t(isOnlySource ? "ch.remove_aria" : "ch.remove_source")}
          aria-describedby={labelId}
          onClick={(event) => controls.askToRemove({ source, isWholeShow: isOnlySource }, event.currentTarget)}
        >
          <Trash2Icon />
        </Button>
      </div>
    </li>
  );
}
