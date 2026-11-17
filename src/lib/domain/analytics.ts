import { ZERO, add, sum, type Money } from "./money";
import type { ActivityRow } from "./inventory";

/**
 * Product performance — SPEC §15.2 "Margin", §15.3 "Chain product performance".
 *
 * The questions a grocery buyer asks of every line, answered from the same
 * per-product activity the stock-and-sales report uses (`productActivity`):
 *
 * - **ABC class** — which lines earn the money. A is the lines that make the
 *   first 80% of sales, B the next 15%, C the long tail. A lines are never
 *   allowed to run out; C lines are where shelf space is recovered.
 * - **GMROI** — gross margin return on inventory: naira of gross profit per
 *   naira of stock held, over the period. Below 1 the line is tying up more
 *   cash on the shelf than it returns.
 * - **Sell-through** — sold ÷ (sold + still on hand). How much of what was
 *   available actually left with a customer.
 * - **Days of cover** — how long the shelf lasts at the period's pace.
 * - **Movement** — fast, steady, slow or dead, from days of cover.
 *
 * Ratios are carried as integers (basis points, hundredths) so a float never
 * sits next to a money figure. Pure. No I/O, no clock, no React.
 */

export type AbcClass = "A" | "B" | "C";
export type Movement = "fast" | "steady" | "slow" | "dead" | "idle";

export type PerformanceRow = {
  productId: string;
  activity: ActivityRow;
  abc: AbcClass;
  /** Cumulative share of sales up to and including this line, in basis points. */
  cumulativeBp: number;
  /** Gross profit as basis points of sales. Null when nothing sold. */
  marginBp: number | null;
  /** Average stock held at cost over the period: (opening + closing) ÷ 2. */
  averageStock: Money;
  /** Gross profit ÷ average stock, in hundredths (245 = 2.45). Null without stock. */
  gmroiCenti: number | null;
  /** Sold ÷ (sold + closing), in basis points. Null when nothing was available. */
  sellThroughBp: number | null;
  /** Closing on hand ÷ daily sales. Null when nothing sold. */
  coverDays: number | null;
  movement: Movement;
};

/** Days of cover at or under which a line is fast; over which it is slow. */
export const FAST_COVER_DAYS = 14;
export const SLOW_COVER_DAYS = 60;

export function classifyPerformance(rows: readonly ActivityRow[], periodDays: number): PerformanceRow[] {
  const days = Math.max(1, periodDays);
  const totalSales = rows.reduce((n, r) => n + Math.max(0, r.salesValue.kobo), 0);

  // ABC by sales, largest first. A line straddling the 80% mark is A — it is
  // the one that takes the total over, and it matters as much as the ones before it.
  const ranked = [...rows].sort((a, b) => b.salesValue.kobo - a.salesValue.kobo || a.productId.localeCompare(b.productId));
  let running = 0;
  const abcOf = new Map<string, { abc: AbcClass; cumulativeBp: number }>();
  for (const r of ranked) {
    const before = totalSales ? (running * 10_000) / totalSales : 10_000;
    running += Math.max(0, r.salesValue.kobo);
    const cumulativeBp = totalSales ? Math.round((running * 10_000) / totalSales) : 10_000;
    const abc: AbcClass = r.salesValue.kobo <= 0 ? "C" : before < 8_000 ? "A" : before < 9_500 ? "B" : "C";
    abcOf.set(r.productId, { abc, cumulativeBp });
  }

  return rows.map((r) => {
    const { abc, cumulativeBp } = abcOf.get(r.productId)!;
    const averageStock: Money = { kobo: Math.round((Math.max(0, r.openingValue.kobo) + Math.max(0, r.closingValue.kobo)) / 2) };
    const sold = r.sold.milli;
    const closing = Math.max(0, r.closing.milli);
    const available = sold + closing;
    const coverDays = sold > 0 ? Math.floor((closing * days) / sold) : null;

    const movement: Movement =
      sold <= 0 ? (closing > 0 ? "dead" : "idle")
      : coverDays! <= FAST_COVER_DAYS ? "fast"
      : coverDays! > SLOW_COVER_DAYS ? "slow"
      : "steady";

    return {
      productId: r.productId,
      activity: r,
      abc,
      cumulativeBp,
      marginBp: r.salesValue.kobo > 0 ? Math.round((r.grossProfit.kobo * 10_000) / r.salesValue.kobo) : null,
      averageStock,
      gmroiCenti: averageStock.kobo > 0 ? Math.round((r.grossProfit.kobo * 100) / averageStock.kobo) : null,
      sellThroughBp: available > 0 && sold >= 0 ? Math.round((sold * 10_000) / available) : null,
      coverDays,
      movement,
    };
  });
}

export type ClassSummary = {
  lines: number;
  sales: Money;
  grossProfit: Money;
  /** Stock held at close, at cost. */
  stock: Money;
};

/** Totals per ABC class — "A is 6 lines, 80% of sales, 31% of the stock". */
export function summariseClasses(rows: readonly PerformanceRow[]): Record<AbcClass, ClassSummary> {
  const empty = (): ClassSummary => ({ lines: 0, sales: ZERO, grossProfit: ZERO, stock: ZERO });
  const out: Record<AbcClass, ClassSummary> = { A: empty(), B: empty(), C: empty() };
  for (const r of rows) {
    const c = out[r.abc];
    c.lines++;
    c.sales = add(c.sales, r.activity.salesValue);
    c.grossProfit = add(c.grossProfit, r.activity.grossProfit);
    c.stock = add(c.stock, r.activity.closingValue);
  }
  return out;
}

/** GMROI for a set of lines: their gross profit over their average stock. */
export function gmroiOf(rows: readonly PerformanceRow[]): number | null {
  const stock = sum(rows.map((r) => r.averageStock));
  if (stock.kobo <= 0) return null;
  return Math.round((sum(rows.map((r) => r.activity.grossProfit)).kobo * 100) / stock.kobo);
}

/** `2.45×` */
export const formatCenti = (centi: number | null) => (centi === null ? "—" : `${(centi / 100).toFixed(2)}×`);
