import {
  ZERO,
  add,
  multiply,
  subtract,
  sum,
  type Money,
} from "./money";
import {
  ONE,
  addQty,
  isZeroQty,
  isNegativeQty,
  toNumber,
  type Quantity,
} from "./quantity";
import type { Product } from "@/types/catalog";

/**
 * The basket — SPEC §9.
 *
 * The rounding rule lives here and nowhere else: **half-up per line, then
 * summed** (CLAUDE.md rule 2). A total is never computed from raw inputs
 * independently of its lines. If it were, the printed lines would add up to
 * something a kobo or two off the printed total, and a customer standing at the
 * counter with a receipt is very good at spotting that.
 *
 * Pure. No I/O, no clock, no React.
 */

export type BasketLine = {
  /** Stable across quantity edits, so React keys and focus survive. */
  id: string;
  product: Product;
  quantity: Quantity;
  /**
   * Price at the moment the line was added. Copied, not read through to the
   * product: a price change mid-sale must not silently reprice a basket the
   * cashier has already quoted.
   */
  unitPrice: Money;
  /** Line-level markdown, e.g. a damaged tin. Never negative. */
  discount: Money;
};

export type BasketTotals = {
  /** Sum of the rounded line totals, before discounts. */
  subtotal: Money;
  discount: Money;
  /** What the customer pays. */
  total: Money;
  /** Distinct lines, not units — "4 lines" is what the cashier sees. */
  lineCount: number;
  /**
   * How many things the customer is carrying out.
   *
   * A plain integer, and deliberately not a `Quantity`: summing quantities
   * across lines adds *each* to *kilograms*, which is a number in no unit at
   * all — one pack of spaghetti beside 5kg of beans came to "6 items". A
   * weighed line is one item however much it weighs.
   */
  itemCount: number;
};

/* ── Lines ────────────────────────────────────────────────────────────────── */

/**
 * A line's own total: unit price × quantity, rounded half-up to the kobo, less
 * any line discount. This is the number that prints, and every total in the
 * system is built from these.
 */
export function lineTotal(line: BasketLine): Money {
  return subtract(multiply(line.unitPrice, toNumber(line.quantity)), line.discount);
}

/**
 * Add a scan to the basket.
 *
 * A second scan of the same product increments the existing line rather than
 * appending a duplicate — that is what a cashier passing three identical tins
 * over the glass expects to see, and a tape with the same name three times is
 * harder to check against the trolley.
 *
 * Weighed goods are the exception: each weighing is its own measurement and
 * merging two of them would destroy the record of what was actually put on the
 * scale, so they always append.
 */
export function addToBasket(
  lines: readonly BasketLine[],
  product: Product,
  quantity: Quantity = ONE,
  makeId: () => string,
): BasketLine[] {
  if (product.soldBy === "unit") {
    const existing = lines.findIndex((line) => line.product.id === product.id);
    if (existing !== -1) {
      return lines.map((line, index) =>
        index === existing
          ? { ...line, quantity: addQty(line.quantity, quantity) }
          : line,
      );
    }
  }

  return [
    ...lines,
    {
      id: makeId(),
      product,
      quantity,
      unitPrice: product.price,
      discount: ZERO,
    },
  ];
}

/**
 * Set a line's quantity outright.
 *
 * Reaching zero removes the line. A zero-quantity line on the tape is a puzzle
 * for the customer and a rounding hazard for the total, and "remove" is what
 * the cashier meant by pressing minus on a quantity of one.
 */
export function setLineQuantity(
  lines: readonly BasketLine[],
  lineId: string,
  quantity: Quantity,
): BasketLine[] {
  if (isZeroQty(quantity) || isNegativeQty(quantity)) {
    return lines.filter((line) => line.id !== lineId);
  }
  return lines.map((line) => (line.id === lineId ? { ...line, quantity } : line));
}

export const removeLine = (
  lines: readonly BasketLine[],
  lineId: string,
): BasketLine[] => lines.filter((line) => line.id !== lineId);

/* ── Totals ───────────────────────────────────────────────────────────────── */

export function basketTotals(lines: readonly BasketLine[]): BasketTotals {
  // Gross per line, rounded — then summed. Never the other way round.
  const grossLines = lines.map((line) =>
    multiply(line.unitPrice, toNumber(line.quantity)),
  );
  const subtotal = sum(grossLines);
  const discount = sum(lines.map((line) => line.discount));

  return {
    subtotal,
    discount,
    total: subtract(subtotal, discount),
    lineCount: lines.length,
    itemCount: lines.reduce(
      (total, line) =>
        total +
        (line.product.soldBy === "weight"
          ? 1
          : Math.round(line.quantity.milli / 1000)),
      0,
    ),
  };
}

/* ── Tender ───────────────────────────────────────────────────────────────── */

/**
 * Change owed on a cash tender. Negative means the tender does not cover it,
 * which the payment sheet shows as a shortfall rather than as change.
 */
export const changeDue = (total: Money, tendered: Money): Money =>
  subtract(tendered, total);

/**
 * The notes a cashier is most likely to be handed for this total.
 *
 * Nigerian notes run ₦100/200/500/1000. Offering "exact" plus the next few
 * round amounts above the total covers almost every real cash tender in one
 * tap, which is the difference between a two-second sale and a keypad entry
 * with a queue building.
 */
export function quickTenders(total: Money): Money[] {
  if (total.kobo <= 0) return [];

  const suggestions: Money[] = [total];
  const steps = [100, 200, 500, 1_000, 2_000, 5_000];

  for (const step of steps) {
    const rounded = { kobo: Math.ceil(total.kobo / (step * 100)) * step * 100 };
    if (rounded.kobo > total.kobo && !suggestions.some((s) => s.kobo === rounded.kobo)) {
      suggestions.push(rounded);
    }
    if (suggestions.length === 5) break;
  }

  return suggestions;
}

/** Sum of what has been tendered so far, across a split payment. */
export const tenderedSoFar = (tenders: readonly { amount: Money }[]): Money =>
  tenders.reduce((total, tender) => add(total, tender.amount), ZERO);
