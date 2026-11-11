import { useEffect, useState } from "react";

import { Search } from "lucide-react";

import { usePaletteCommands, type PaletteCommand } from "@/app/use-palette-commands";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList, CommandShortcut } from "@/components/ui/command";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/i18n/use-i18n";
import { BUTTON } from "@/lib/touch";

const isPaletteShortcut = (event: KeyboardEvent) =>
  (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";

type HintProps = { keyName: string; label: string };

function Hint({ keyName, label }: HintProps) {
  return (
    <span className="flex items-center gap-1">
      <kbd className="font-sans">{keyName}</kbd>
      {label}
    </span>
  );
}

type PaletteProps = { onRun: (command: PaletteCommand) => void };

function Palette({ onRun }: PaletteProps) {
  const { t } = useI18n();
  const commands = usePaletteCommands();

  return (
    <Command label={t("shell.cmdk_title")}>
      <CommandInput placeholder={t("palette.placeholder")} />
      <CommandList>
        <CommandEmpty>{t("palette.empty")}</CommandEmpty>
        {commands.map((command) => (
          <CommandItem
            key={command.label}
            value={command.label}
            keywords={command.hint ? [command.hint] : undefined}
            onSelect={() => onRun(command)}
          >
            <command.icon />
            {command.label}
            {command.hint && (
              <CommandShortcut className="tracking-normal" aria-hidden>
                {command.hint}
              </CommandShortcut>
            )}
          </CommandItem>
        ))}
      </CommandList>
      <div className="flex gap-4 border-t px-3 py-2 text-xs text-muted-foreground">
        <Hint keyName="↑↓" label={t("palette.navigate")} />
        <Hint keyName="↵" label={t("palette.run")} />
        <Hint keyName="esc" label={t("palette.close")} />
      </div>
    </Command>
  );
}

/** The header's palette button, the ⌘K / Ctrl+K shortcut and the palette they open. */
export function CommandPalette() {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isPaletteShortcut(event)) return;
      event.preventDefault();
      setIsOpen((wasOpen) => !wasOpen);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const runCommand = (command: PaletteCommand) => {
    setIsOpen(false);
    command.run();
  };

  return (
    <>
      <Button
        variant="outline"
        className={`ml-auto ${BUTTON}`}
        aria-label={t("shell.cmdk_aria")}
        title={t("shell.cmdk_title")}
        onClick={() => setIsOpen(true)}
      >
        <Search />
        <kbd className="hidden font-sans text-xs text-muted-foreground sm:inline">⌘K</kbd>
      </Button>
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent
          className="top-1/4 translate-y-0 overflow-hidden p-0"
          showCloseButton={false}
          aria-describedby={undefined}
        >
          <DialogTitle className="sr-only">{t("shell.cmdk_title")}</DialogTitle>
          <Palette onRun={runCommand} />
        </DialogContent>
      </Dialog>
    </>
  );
}
