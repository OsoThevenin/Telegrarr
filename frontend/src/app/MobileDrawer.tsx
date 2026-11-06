import { useRef, useState } from "react";

import { Menu } from "lucide-react";

import { ShellMenu } from "@/app/ShellMenu";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useI18n } from "@/i18n/use-i18n";

/** The sidebar on phones: a menu button in the top bar opens it as a drawer. */
export function MobileDrawer() {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // Radix skips links when it picks the first focus, which here is the language
  // switch, below every screen.
  const focusFirstLink = (event: Event) => {
    event.preventDefault();
    contentRef.current?.querySelector("a")?.focus();
  };

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon-lg" className="md:hidden" aria-label={t("shell.open_menu")}>
          <Menu />
        </Button>
      </SheetTrigger>
      <SheetContent
        ref={contentRef}
        side="left"
        closeLabel={t("common.close")}
        aria-describedby={undefined}
        onOpenAutoFocus={focusFirstLink}
        className="w-72 bg-sidebar p-0"
      >
        <SheetTitle className="sr-only">{t("shell.menu")}</SheetTitle>
        <ShellMenu onNavigate={() => setIsOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
