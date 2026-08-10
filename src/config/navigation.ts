import {
  ArrowRightLeft,
  Boxes,
  Building2,
  ChartColumn,
  ClipboardCheck,
  IdCard,
  LayoutDashboard,
  Package,
  ReceiptText,
  ScanBarcode,
  ScrollText,
  ShieldCheck,
  TabletSmartphone,
  Truck,
  Users,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { StaffRole } from "@/types";

export type NavItem = {
  href: string;
  label: string;
  /**
   * Name shown under the icon in the till's labelled rail, where there are
   * ~64px of width. Falls back to `label` when it already fits. Keep these to a
   * single short word — a truncated label ("My sale…") is worse than none.
   */
  shortLabel?: string;
  icon: LucideIcon;
  /** Key into the badge counts the sidebar is handed. Absent = never badged. */
  badge?: "approvals" | "lowStock" | "exceptions";
};

export type NavSection = {
  /** Omitted on the first section — a heading above the first item is noise. */
  title?: string;
  items: NavItem[];
};

/**
 * Navigation per workspace — SPEC §15.
 *
 * Ordered by how often a person in that role actually needs the screen, not
 * alphabetically and not by how the database is laid out. The manager's day
 * starts with exceptions, so approvals sit directly under the overview.
 */
export const NAVIGATION: Record<StaffRole, NavSection[]> = {
  sales_person: [
    {
      items: [
        { href: "/till", label: "Sell", icon: ScanBarcode },
        {
          href: "/till/history",
          label: "My sales",
          shortLabel: "Sales",
          icon: ReceiptText,
        },
        { href: "/till/shift", label: "Shift", icon: Wallet },
      ],
    },
  ],

  branch_manager: [
    {
      items: [
        { href: "/manager", label: "Overview", icon: LayoutDashboard },
        {
          href: "/manager/approvals",
          label: "Approvals",
          icon: ShieldCheck,
          badge: "approvals",
        },
      ],
    },
    {
      title: "Stock",
      items: [
        { href: "/manager/stock", label: "Stock", icon: Package, badge: "lowStock" },
        { href: "/manager/counts", label: "Counts", icon: ClipboardCheck },
        { href: "/manager/transfers", label: "Transfers", icon: ArrowRightLeft },
        { href: "/manager/orders", label: "Purchase orders", icon: Truck },
      ],
    },
    {
      title: "Branch",
      items: [
        { href: "/manager/staff", label: "Staff", icon: Users },
        { href: "/manager/customers", label: "Customers", icon: IdCard },
        { href: "/manager/reports", label: "Reports", icon: ChartColumn },
      ],
    },
  ],

  general_admin: [
    {
      items: [
        { href: "/hq", label: "Overview", icon: LayoutDashboard },
        {
          href: "/hq/branches",
          label: "Branches",
          icon: Building2,
          badge: "exceptions",
        },
      ],
    },
    {
      title: "Chain",
      items: [
        { href: "/hq/catalog", label: "Master catalog", icon: Boxes },
        { href: "/hq/staff", label: "Staff", icon: Users },
        { href: "/hq/devices", label: "Devices", icon: TabletSmartphone },
      ],
    },
    {
      title: "Oversight",
      items: [
        { href: "/hq/reports", label: "Reports", icon: ChartColumn },
        { href: "/hq/audit", label: "Audit log", icon: ScrollText },
      ],
    },
  ],
};

export type BadgeCounts = Partial<Record<NonNullable<NavItem["badge"]>, number>>;

/**
 * Whether a nav item is the one currently open.
 *
 * Exact match for a workspace root (`/manager` must not stay lit on
 * `/manager/stock`), prefix match for everything below it.
 */
export function isNavItemActive(
  href: string,
  pathname: string,
  roots: readonly string[] = ["/till", "/manager", "/hq"],
): boolean {
  if (roots.includes(href)) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}
