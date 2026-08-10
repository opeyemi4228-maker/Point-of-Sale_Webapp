import type { Money } from "@/lib/domain/money";
import type { HourlyBucket } from "@/components/shared/hourly-sales-chart";
import type { BadgeCounts } from "@/config/navigation";
import type { PaymentMethod } from "./enums";

/** How loudly a thing asks for attention. Always paired with an icon and words. */
export type Severity = "serious" | "warning" | "info";

/** A row in a "needs you now" list — SPEC §15.2, §15.3. */
export type AttentionItem = {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  actionLabel: string;
  href: string;
};

export type ShiftRow = {
  staffId: string;
  staffName: string;
  tillLabel: string;
  /**
   * When the shift opened, as an ISO instant in UTC — formatted to Lagos at the
   * presentation layer only, like every other timestamp here (SPEC §7).
   *
   * Said explicitly because it was not: a bare `string` let the fixtures put a
   * clock face ("08:02") here while the database returned an instant, and the
   * screen that formatted it crashed on whichever one it did not expect.
   */
  since: string;
  sales: Money;
  transactions: number;
  cashHeld: Money;
};

export type ManagerOverview = {
  branchName: string;
  /** ISO instant the figures were taken. Formatted for Lagos at render. */
  asOf: string;
  attention: AttentionItem[];
  today: {
    sales: Money;
    transactions: number;
    averageBasket: Money;
    grossMarginPercent: number;
  };
  hourly: HourlyBucket[];
  onShift: ShiftRow[];
  badges: BadgeCounts;
};

export type BranchPerformance = {
  id: string;
  name: string;
  sales: Money;
  /** Signed percentage against the same day last week. */
  deltaPercent: number;
  transactions: number;
  averageBasket: Money;
  marginPercent: number;
  alerts: number;
  alertsAreSerious: boolean;
};

export type HqOverview = {
  asOf: string;
  today: {
    sales: Money;
    transactions: number;
    averageBasket: Money;
    marginPercent: number;
    loyaltyIssued: Money;
  };
  branches: BranchPerformance[];
  attention: AttentionItem[];
  badges: BadgeCounts;
};

export type CashierTransaction = {
  id: string;
  receiptNo: string;
  /** HH:mm, Lagos. */
  time: string;
  items: number;
  total: Money;
  method: PaymentMethod;
  customerName?: string;
};

export type CashierOverview = {
  staffName: string;
  branchName: string;
  asOf: string;
  shift: {
    tillLabel: string;
    openedAt: string;
    openingFloat: Money;
  } | null;
  today: {
    sales: Money;
    transactions: number;
    itemsSold: number;
    averageBasket: Money;
    cashPosition: Money;
    pointsIssued: number;
  };
  hourly: HourlyBucket[];
  recent: CashierTransaction[];
};
