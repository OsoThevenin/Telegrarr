import { Link } from "@tanstack/react-router";
import { LogOut } from "lucide-react";

import { LanguageSwitch } from "@/app/LanguageSwitch";
import { NAV_ITEMS } from "@/app/navigation";
import { useI18n } from "@/i18n/use-i18n";

const ROW = "flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium hover:bg-sidebar-accent";

function Logo() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className="size-7">
      <rect width="64" height="64" rx="14" fill="#0071e3" />
      <g fill="none" stroke="#fff" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M32 15 V35" />
        <path d="M23 27 L32 36 L41 27" />
        <path d="M17 40 V45 A4 4 0 0 0 21 49 H43 A4 4 0 0 0 47 45 V40" />
      </g>
    </svg>
  );
}

type Props = {
  /** Called when a link is followed, so the drawer can close. */
  onNavigate?: () => void;
};

/** The sidebar's content, shared by the desktop sidebar and the phone drawer. */
export function ShellMenu({ onNavigate }: Props) {
  const { t } = useI18n();

  return (
    <div className="flex h-full flex-col gap-4 p-3">
      <div className="flex items-center gap-2 px-3 pt-2 text-lg font-semibold">
        <Logo />
        <span>
          Telegr<b className="text-primary">arr</b>
        </span>
      </div>
      <nav aria-label={t("shell.main_nav")} className="flex flex-1 flex-col gap-1 overflow-y-auto">
        {NAV_ITEMS.map(({ to, labelKey, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            activeOptions={{ exact: to === "/" }}
            className={`${ROW} aria-[current=page]:bg-sidebar-accent aria-[current=page]:text-primary`}
            onClick={onNavigate}
          >
            <Icon className="size-4" aria-hidden="true" />
            {t(labelKey)}
          </Link>
        ))}
      </nav>
      <div className="flex flex-col gap-2 px-3 md:px-0">
        <LanguageSwitch />
        <a href="/logout" className={`${ROW} -mx-3 text-muted-foreground md:mx-0 md:px-0`}>
          <LogOut className="size-4" aria-hidden="true" />
          {t("shell.sign_out")}
        </a>
      </div>
    </div>
  );
}
