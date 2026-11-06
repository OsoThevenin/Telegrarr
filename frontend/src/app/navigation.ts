import {
  Activity,
  ClipboardCheck,
  Download,
  LayoutDashboard,
  Link2,
  MonitorCog,
  Radio,
  Settings,
  type LucideIcon,
} from "lucide-react";

import type { LinkProps } from "@tanstack/react-router";

type NavItem = {
  to: NonNullable<LinkProps["to"]>;
  labelKey: string;
  icon: LucideIcon;
};

export const NAV_ITEMS: readonly NavItem[] = [
  { to: "/", labelKey: "nav.dashboard", icon: LayoutDashboard },
  { to: "/channels", labelKey: "nav.channels", icon: Radio },
  { to: "/downloads", labelKey: "nav.downloads", icon: Download },
  { to: "/activity", labelKey: "nav.activity", icon: Activity },
  { to: "/review", labelKey: "nav.review", icon: ClipboardCheck },
  { to: "/connect", labelKey: "nav.connect", icon: Link2 },
  { to: "/system", labelKey: "nav.system", icon: MonitorCog },
  { to: "/settings", labelKey: "nav.settings", icon: Settings },
];
