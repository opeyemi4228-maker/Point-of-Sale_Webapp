import { ZERO, add, subtract, sum, type Money } from "./money";
import { negateQty } from "./quantity";
import { lineTotal, type BasketLine } from "./basket";
import type { Sale, SaleLine, Tender } from "@/types/sale";
import type { StockEntry } from "@/types/stock";
import type { Staff } from "@/types/staff";
import { earnedOnSale } from "./loyalty";
import { KOBO_PER_POINT } from "@/config/loyalty";
import type { LoyaltyTier } from "@/types/enums";
import { isoDay } from "@/lib/utils/format-date";

/**
 * What a sale needs to know about a customer, and no more.
 *
 * Not the whole `Customer`: this module is pure and must not depend on a
 * lifetime-spend figure that is derived from a database read. The tier is
 * resolved by the caller and passed in.
 */
export type SaleCustomer = {
  readonly id: string;
  readonly fullName: string;
  readonly tier: LoyaltyTier;
};

/**
 * Turning a basket into a sale — SPEC §11, §12.
 *
 * This is the seam the whole system hangs off: it is the one place a basket
 * becomes a record, and the same call produces both the sale and the stock
 * movements it caused. They are built together on purpose. When they were built
 * separately, the till settled a sale and stock never moved, and the manager's
 * screen disagreed with what had actually left the shelf.
 *
 * Pure. No I/O, no clock, no React — the instant and the sequence number are
 * passed in, so this is fully testable and gives the same answer twice.
 */

/**
 * `SG-GWA-20260728-0042` — SPEC §12.
 *
 * Branch-scoped and date-scoped so two tills in different branches cannot
 * collide, and so a receipt can be found from the paper without a database.
 * The sequence is per branch per day and resets at midnight, which is what the
 * paper receipts a customer brings back are numbered by.
 */
export function receiptNumber(
  branchId: string,
  at: string,
  sequence: number,
): string {
  const code = branchCode(branchId);
  // The Lagos day, not `at.slice(0, 10)`. A sale rung at 00:30 in Lagos is the
  // previous day in UTC, so the slice dated it yesterday while the sequence
  // counter — which already used the Lagos day — started again at 0001. Two
  // receipts a year would have carried the same number.
  const day = isoDay(at).replace(/-/g, "");
  return `SG-${code}-${day}-${String(sequence).padStart(4, "0")}`;
}

/**
 * `brn_gwarinpa` → `GWA`. Stable, and readable on a printed receipt.
 *
 * The prefix is stripped with `brn?_` rather than a literal, because getting
 * this wrong is silent: an unmatched prefix still produces three characters, so
 * every receipt in the chain printed `SG-BRN-…` and looked plausible while
 * carrying no branch at all.
 */
function branchCode(branchId: string): string {
  return branchId.replace(/^brn?_/, "").slice(0, 3).toUpperCase();
}

export function buildSale({
  lines,
  tenders,
  staff,
  at,
  sequence,
  takenOffline,
  customer,
}: {
  lines: readonly BasketLine[];
  tenders: readonly Tender[];
  staff: Staff;
  /** ISO instant, supplied by the caller so this stays pure. */
  at: string;
  sequence: number;
  takenOffline: boolean;
  /**
   * The loyalty member, when one was given. Optional at every call site — a
   * sale without a card is the ordinary sale, not a degraded one (SPEC §11).
   */
  customer?: SaleCustomer | null;
}): Sale {
  const saleLines: SaleLine[] = lines.map((line) => ({
    productId: line.product.id,
    name: line.product.name,
    sku: line.product.sku,
    quantity: line.quantity,
    soldBy: line.product.soldBy,
    unit: line.product.unit,
    unitPrice: line.unitPrice,
    discount: line.discount,
    // Stored, not recomputed later: the receipt in the customer's hand and the
    // report six months from now must show the same figure.
    lineTotal: lineTotal(line),
  }));

  const subtotal = sum(saleLines.map((line) => line.lineTotal));
  const discount = sum(saleLines.map((line) => line.discount));
  const total = subtotal;
  const tendered = tenders.reduce((running, t) => add(running, t.amount), ZERO);

  // Change can only be given against cash. Card and transfer settle exactly, so
  // any excess there would be a data-entry error rather than money owed.
  const cashTendered = tenders
    .filter((t) => t.method === "cash")
    .reduce((running, t) => add(running, t.amount), ZERO);
  const change =
    cashTendered.kobo > 0 && tendered.kobo > total.kobo
      ? subtract(tendered, total)
      : ZERO;

  const branchId = staff.branchId ?? "br_unassigned";

  // Points settle like any other tender, so the receipt adds up without a
  // special case. What they earn is computed on the money actually paid — the
  // part covered by points earns nothing, or the scheme compounds into a
  // currency (see lib/domain/loyalty).
  const paidWithPoints = tenders
    .filter((t) => t.method === "loyalty_points")
    .reduce((running, t) => add(running, t.amount), ZERO);

  const pointsRedeemed = paidWithPoints.kobo / KOBO_PER_POINT;
  const pointsEarned = customer
    ? earnedOnSale(total, paidWithPoints, customer.tier)
    : 0;

  return {
    id: `sal_${branchId}_${at}_${sequence}`,
    receiptNo: receiptNumber(branchId, at, sequence),
    branchId,
    branchName: staff.branchName ?? "Unassigned",
    staffId: staff.id,
    staffName: staff.fullName,
    staffCode: staff.staffCode,
    customerId: customer?.id ?? null,
    customerName: customer?.fullName ?? null,
    pointsEarned,
    pointsRedeemed,
    lines: saleLines,
    subtotal,
    discount,
    total,
    tenders,
    change,
    status: "completed",
    at,
    takenOffline,
    syncedAt: takenOffline ? null : at,
  };
}

/**
 * The stock the sale took off the shelf — one negative movement per line.
 *
 * Derived from the sale rather than from the basket, so the ledger can never
 * describe something the receipt does not. `ref` carries the receipt number,
 * which is how a manager gets from a suspicious balance back to the sale that
 * caused it.
 */
export function stockMovementsForSale(sale: Sale): Omit<StockEntry, "id">[] {
  return sale.lines.map((line) => ({
    branchId: sale.branchId,
    productId: line.productId,
    delta: negateQty(line.quantity),
    reason: "SALE" as const,
    at: sale.at,
    staffId: sale.staffId,
    staffName: sale.staffName,
    ref: sale.receiptNo,
    ...(sale.takenOffline ? { note: "Rung while offline" } : {}),
  }));
}

/**
 * How many things the customer is carrying out.
 *
 * Units of measure are not addable. Six of something is a countable number of
 * packets; 5kg of beans is one weighed item, not five. So countable lines
 * contribute their quantity and weighed lines contribute one each — which is
 * what a customer checking their bag against the paper actually counts.
 */
export function itemCount(lines: readonly SaleLine[]): number {
  return lines.reduce(
    (running, line) =>
      running +
      (line.soldBy === "weight" ? 1 : Math.round(line.quantity.milli / 1000)),
    0,
  );
}

/* ── Reporting ────────────────────────────────────────────────────────────── */

export type SellerTotals = {
  staffId: string;
  staffName: string;
  branchId: string;
  branchName: string;
  sales: Money;
  transactions: number;
  /** Countable items — see `itemCount`. Never a summed `Quantity`. */
  items: number;
};

/** Roll sales up per person — the figure HQ ranks by (§15.3). */
export function totalsByStaff(sales: readonly Sale[]): SellerTotals[] {
  const byStaff = new Map<string, SellerTotals>();

  for (const sale of sales) {
    if (sale.status !== "completed") continue;

    const current = byStaff.get(sale.staffId);
    const items = itemCount(sale.lines);

    if (!current) {
      byStaff.set(sale.staffId, {
        staffId: sale.staffId,
        staffName: sale.staffName,
        branchId: sale.branchId,
        branchName: sale.branchName,
        sales: sale.total,
        transactions: 1,
        items,
      });
      continue;
    }

    current.sales = add(current.sales, sale.total);
    current.transactions += 1;
    current.items += items;
  }

  return [...byStaff.values()];
}

/** Everything rung on a given Lagos calendar day. */
export function salesOnDay(sales: readonly Sale[], day: string): Sale[] {
  return sales.filter((sale) => isoDay(sale.at) === day);
}

/** Cash the drawer should hold: opening float plus cash in, less change out. */
export function expectedCash(
  openingFloat: Money,
  sales: readonly Sale[],
): Money {
  const cashIn = sales.flatMap((sale) =>
    sale.tenders.filter((t) => t.method === "cash").map((t) => t.amount),
  );
  const changeOut = sales.map((sale) => sale.change);

  return subtract(add(openingFloat, sum(cashIn)), sum(changeOut));
}
