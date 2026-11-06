import { useRef } from "react";

import { EllipsisIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/i18n/use-i18n";
import { showTitle, type Show } from "@/screens/channels/channel";
import type { ChannelControls } from "@/screens/channels/channel-controls";

type Props = {
  show: Show;
  controls: ChannelControls;
};

/** Every action of a card. Not modal: the page keeps its scroll and its pointer events. */
export function ChannelMenu({ show, controls }: Props) {
  const { t } = useI18n();
  const trigger = useRef<HTMLButtonElement>(null);
  const { actions } = controls;
  const { lead, sources } = show;
  const anyEnabled = sources.some(({ enabled }) => enabled);

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button ref={trigger} variant="ghost" size="icon-lg" aria-label={t("ch.actions_of", { title: showTitle(show) })}>
          <EllipsisIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => actions.scan(sources)}>{t("common.scan")}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => actions.backfill(sources)}>{t("ch.backfill")}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => actions.setEnabled(sources, !anyEnabled)}>
          {anyEnabled ? t("common.disable") : t("common.enable")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {sources.length > 1 ? (
          <DropdownMenuItem onSelect={() => controls.openShow(show, trigger.current)}>
            {t("ch.sources_btn")}
          </DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuItem onSelect={() => controls.editSource(lead, trigger.current)}>
              {t("common.edit")}
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => controls.askToRemove({ source: lead, isWholeShow: true }, trigger.current)}
            >
              {t("common.remove")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
