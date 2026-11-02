import {
  Activity,
  BarChart3,
  FileClock,
  FilePlus2,
  Inbox,
  LayoutDashboard,
  ListChecks,
  type LucideIcon,
  Network,
  PlugZap,
  ScrollText,
  Settings2,
  TriangleAlert,
} from "lucide-react";

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  /** Phase in which the page's functionality is delivered. */
  phase: number;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    label: "Operations",
    items: [
      { title: "Overview", href: "/", icon: LayoutDashboard, phase: 1 },
      { title: "Jobs", href: "/jobs", icon: ListChecks, phase: 2 },
      { title: "Incoming Jobs", href: "/incoming", icon: Inbox, phase: 3 },
      { title: "Create Job", href: "/jobs/new", icon: FilePlus2, phase: 3 },
    ],
  },
  {
    label: "Automation",
    items: [
      { title: "Portal Management", href: "/portals", icon: Network, phase: 4 },
      { title: "Automation Queue", href: "/queue", icon: Activity, phase: 5 },
      { title: "Execution History", href: "/executions", icon: FileClock, phase: 7 },
      { title: "Failed Jobs", href: "/failed", icon: TriangleAlert, phase: 5 },
    ],
  },
  {
    label: "Insights & Admin",
    items: [
      { title: "Analytics", href: "/analytics", icon: BarChart3, phase: 7 },
      { title: "Integration Settings", href: "/settings/integrations", icon: PlugZap, phase: 6 },
      { title: "Audit Logs", href: "/audit", icon: ScrollText, phase: 7 },
      { title: "System Configuration", href: "/settings/system", icon: Settings2, phase: 5 },
    ],
  },
];

export const NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((s) => s.items);

/** Longest-prefix match so /jobs/new highlights "Create Job", not "Jobs". */
export function findActiveNavItem(pathname: string): NavItem | undefined {
  return NAV_ITEMS.filter((item) =>
    item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`),
  ).sort((a, b) => b.href.length - a.href.length)[0];
}
