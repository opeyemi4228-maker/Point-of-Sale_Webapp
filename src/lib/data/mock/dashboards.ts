import { naira } from "@/lib/domain/money";
import { ZERO_QTY, formatQty } from "@/lib/domain/quantity";
import { balancesForBranch, isLow, isOversold } from "@/lib/domain/stock";
import { MOCK_PRODUCTS } from "./catalog";
import { MOCK_STOCK_LEDGER } from "./stock";
import { CURRENT_BRANCH_ID } from "./branches";
import type {
  CashierOverview,
  HqOverview,
  ManagerOverview,
} from "@/types/dashboard";

/**
 * FIXTURE DATA — deleted when the real reporting endpoints land (SPEC §16).
 *
 * The figures are the ones in the spec's screen mock-ups (§15.2, §15.3), so the
 * built screens can be read directly against the document they came from. `asOf`
 * is fixed rather than `new Date()` so the server and client render the same
 * string and nothing flickers on hydration.
 */
const AS_OF = "2026-07-28T14:32:00+01:00";

/**
 * The low-stock figures are derived from the ledger rather than typed here.
 *
 * They were typed here, and they drifted: the badge promised seven lines below
 * reorder while the ledger held nine, so the sidebar, the exception list and
 * the stock screen each told the manager something different. A count that is
 * computed from the same movements the stock screen reads cannot disagree with
 * it — which is the whole argument for derived balances (CLAUDE.md rule 3),
 * applied to the fixtures as well as to the app.
 */
const branchStock = balancesForBranch(MOCK_STOCK_LEDGER, CURRENT_BRANCH_ID);

const lowLines = MOCK_PRODUCTS.filter((product) => {
  if (product.delistedAt) return false;
  const onHand = branchStock.get(product.id)?.onHand ?? ZERO_QTY;
  return !isOversold(onHand) && isLow(onHand, product.reorderLevel);
});

const oversoldLines = MOCK_PRODUCTS.filter((product) => {
  if (product.delistedAt) return false;
  return isOversold(branchStock.get(product.id)?.onHand ?? ZERO_QTY);
});

/** "Peak Milk 400g (3 left), Sugar 1kg (1 left), and 5 more" — built, not typed. */
function describeLowLines(): string {
  const named = lowLines
    .slice(0, 2)
    .map((product) => {
      const onHand = branchStock.get(product.id)?.onHand ?? ZERO_QTY;
      return `${product.name} (${formatQty(onHand)} left)`;
    })
    .join(", ");

  const rest = lowLines.length - 2;
  return rest > 0 ? `${named}, and ${rest} more` : named;
}

/* ── Branch manager · Gwarinpa ────────────────────────────────────────────── */

export const MOCK_MANAGER_OVERVIEW: ManagerOverview = {
  branchName: "Gwarinpa",
  asOf: AS_OF,
  badges: { approvals: 2, lowStock: lowLines.length },

  attention: [
    {
      id: "att_approvals",
      severity: "serious",
      title: "2 approvals waiting",
      detail: "Refund ₦12,400 · Blessing A. · raised 11 minutes ago",
      actionLabel: "Review",
      href: "/manager/approvals",
    },
    {
      id: "att_variance",
      severity: "serious",
      title: "Cash variance −₦3,200",
      detail: "Chidi O., shift closed 13:04 · over the ₦2,000 limit",
      actionLabel: "Resolve",
      href: "/manager/staff",
    },
    {
      id: "att_reorder",
      severity: "warning",
      title: `${lowLines.length} products below reorder level`,
      detail: describeLowLines(),
      actionLabel: "Order",
      href: "/manager/stock",
    },
    {
      id: "att_oversell",
      severity: "warning",
      title: `${oversoldLines.length} offline oversell`,
      detail: "Devon King's Oil 3L sold at −2 on Till 2 while offline",
      actionLabel: "Review",
      href: "/manager/stock",
    },
  ],

  today: {
    sales: naira(1_284_500),
    transactions: 312,
    averageBasket: naira(4_117),
    grossMarginPercent: 22.4,
  },

  hourly: [
    { hour: 8, total: naira(64_200), transactions: 18 },
    { hour: 9, total: naira(98_400), transactions: 27 },
    { hour: 10, total: naira(142_900), transactions: 36 },
    { hour: 11, total: naira(131_600), transactions: 33 },
    { hour: 12, total: naira(178_300), transactions: 44 },
    { hour: 13, total: naira(196_800), transactions: 47 },
    { hour: 14, total: naira(121_400), transactions: 31 },
    { hour: 15, total: naira(96_700), transactions: 24 },
    { hour: 16, total: naira(84_100), transactions: 22 },
    { hour: 17, total: naira(112_500), transactions: 19 },
    { hour: 18, total: naira(57_600), transactions: 11 },
  ],

  onShift: [
    {
      staffId: "stf_cashier_01",
      staffName: "Blessing Achike",
      tillLabel: "Till 1",
      since: "2026-07-28T08:02:00+01:00",
      sales: naira(412_300),
      transactions: 98,
      cashHeld: naira(186_400),
    },
    {
      staffId: "stf_cashier_02",
      staffName: "Chidi Obi",
      tillLabel: "Till 2",
      since: "2026-07-28T08:00:00+01:00",
      sales: naira(388_900),
      transactions: 87,
      cashHeld: naira(201_050),
    },
    {
      staffId: "stf_cashier_03",
      staffName: "Ada Mbeki",
      tillLabel: "Till 3",
      since: "2026-07-28T12:30:00+01:00",
      sales: naira(121_400),
      transactions: 34,
      cashHeld: naira(64_200),
    },
  ],
};

/* ── General admin · chain-wide ───────────────────────────────────────────── */

export const MOCK_HQ_OVERVIEW: HqOverview = {
  asOf: AS_OF,
  badges: { exceptions: 16 },

  today: {
    sales: naira(8_420_000),
    transactions: 2_104,
    averageBasket: naira(4_002),
    marginPercent: 23.1,
    loyaltyIssued: naira(412_000),
  },

  branches: [
    {
      id: "brn_wuse",
      name: "Wuse II",
      sales: naira(1_876_200),
      deltaPercent: 3.1,
      transactions: 398,
      averageBasket: naira(4_714),
      marginPercent: 24.8,
      alerts: 1,
      alertsAreSerious: false,
    },
    {
      id: "brn_gwarinpa",
      name: "Gwarinpa",
      sales: naira(1_284_500),
      deltaPercent: 12.4,
      transactions: 312,
      averageBasket: naira(4_117),
      marginPercent: 22.4,
      alerts: 4,
      alertsAreSerious: false,
    },
    {
      id: "brn_kubwa",
      name: "Kubwa",
      sales: naira(1_102_400),
      deltaPercent: 1.7,
      transactions: 281,
      averageBasket: naira(3_923),
      marginPercent: 21.2,
      alerts: 2,
      alertsAreSerious: false,
    },
    {
      id: "brn_lugbe",
      name: "Lugbe",
      sales: naira(742_100),
      deltaPercent: -8.2,
      transactions: 204,
      averageBasket: naira(3_638),
      marginPercent: 19.9,
      alerts: 9,
      alertsAreSerious: true,
    },
  ],

  attention: [
    {
      id: "hq_margin",
      severity: "serious",
      title: "Lugbe margin down 4.1 points over 14 days",
      detail: "Pricing or shrinkage — a stock count is also overdue there",
      actionLabel: "Investigate",
      href: "/hq/reports",
    },
    {
      id: "hq_stockout",
      severity: "serious",
      title: "Sugar 1kg out of stock at 3 of 6 branches",
      detail: "Gwarinpa, Lugbe and Kubwa are all at zero on hand",
      actionLabel: "View stock",
      href: "/hq/catalog",
    },
    {
      id: "hq_device",
      severity: "warning",
      title: "Till 2 at Kubwa offline for 4h 12m",
      detail: "Device or connectivity — 34 sales queued on the device",
      actionLabel: "Check device",
      href: "/hq/devices",
    },
    {
      id: "hq_counts",
      severity: "warning",
      title: "3 stock counts overdue",
      detail: "Lugbe, Kubwa and Wuse II have not counted in over 30 days",
      actionLabel: "View branches",
      href: "/hq/branches",
    },
  ],
};

/* ── Sales person · own numbers only ──────────────────────────────────────── */

export const MOCK_CASHIER_OVERVIEW: CashierOverview = {
  staffName: "Blessing Achike",
  branchName: "Gwarinpa",
  asOf: AS_OF,

  shift: {
    tillLabel: "Till 1",
    openedAt: "08:02",
    openingFloat: naira(20_000),
  },

  today: {
    sales: naira(412_300),
    transactions: 98,
    itemsSold: 341,
    averageBasket: naira(4_207),
    cashPosition: naira(186_400),
    pointsIssued: 3_842,
  },

  hourly: [
    { hour: 8, total: naira(28_400), transactions: 7 },
    { hour: 9, total: naira(41_200), transactions: 11 },
    { hour: 10, total: naira(58_900), transactions: 14 },
    { hour: 11, total: naira(52_300), transactions: 13 },
    { hour: 12, total: naira(71_600), transactions: 17 },
    { hour: 13, total: naira(78_400), transactions: 18 },
    { hour: 14, total: naira(46_100), transactions: 12 },
    { hour: 15, total: naira(35_400), transactions: 6 },
  ],

  recent: [
    {
      id: "sal_0098",
      receiptNo: "ABJ03-T1-20260728-0098",
      time: "14:32",
      items: 5,
      total: naira(25_570),
      method: "cash",
      customerName: "Ade O.",
    },
    {
      id: "sal_0097",
      receiptNo: "ABJ03-T1-20260728-0097",
      time: "14:28",
      items: 2,
      total: naira(7_950),
      method: "pos_terminal",
    },
    {
      id: "sal_0096",
      receiptNo: "ABJ03-T1-20260728-0096",
      time: "14:21",
      items: 11,
      total: naira(48_200),
      method: "transfer",
      customerName: "Ngozi E.",
    },
    {
      id: "sal_0095",
      receiptNo: "ABJ03-T1-20260728-0095",
      time: "14:14",
      items: 1,
      total: naira(2_100),
      method: "cash",
    },
    {
      id: "sal_0094",
      receiptNo: "ABJ03-T1-20260728-0094",
      time: "14:09",
      items: 7,
      total: naira(31_480),
      method: "split",
      customerName: "Tunji B.",
    },
    {
      id: "sal_0093",
      receiptNo: "ABJ03-T1-20260728-0093",
      time: "14:02",
      items: 3,
      total: naira(12_400),
      method: "loyalty_points",
      customerName: "Ade O.",
    },
    {
      id: "sal_0092",
      receiptNo: "ABJ03-T1-20260728-0092",
      time: "13:56",
      items: 4,
      total: naira(18_750),
      method: "cash",
    },
    {
      id: "sal_0091",
      receiptNo: "ABJ03-T1-20260728-0091",
      time: "13:49",
      items: 9,
      total: naira(37_900),
      method: "pos_terminal",
      customerName: "Ifeanyi K.",
    },
  ],
};
