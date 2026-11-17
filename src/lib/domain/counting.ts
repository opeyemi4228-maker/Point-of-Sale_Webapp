import { add, multiply, ZERO, type Money } from "./money";
import { ZERO_QTY, addQty, subtractQty, toNumber, type Quantity } from "./quantity";
import type { StockEntry } from "@/types/stock";

/**
 * Stock counts — SPEC §10.3.
 *
 * A count is how the ledger meets the shelf. Someone walks the aisle, writes
 * down what is physically there, and the difference from what the ledger says
 * becomes one `COUNT_ADJUSTMENT` movement per line. The balance is never set to
 * the counted figure (CLAUDE.md rule 3): the variance is appended, so the
 * record shows what the system thought, what was found, and who found it.
 *
 * Two rules carry most of the weight here:
 *
 * 1. **Expected is the balance when the line was counted, not when the sheet
 *    was cut.** A shop does not close for a stock-take. If twelve tins of milk
 *    sell between printing the sheet and counting the shelf, the shelf is
 *    twelve lighter for a perfectly good reason, and comparing against the
 *    morning's figure would report twelve tins of shrinkage that never
 *    happened. Each counted line carries its own timestamp and is compared
 *    with the ledger as it stood at that instant.
 *
 * 2. **An uncounted line is not a zero.** A line left blank was not counted;
 *    posting it as zero would write off everything on that shelf. Uncounted
 *    lines are reported and skipped.
 *
 * Pure. No I/O, no clock, no React.
 */

export type CountStatus = "counting" | "posted" | "abandoned";

export type CountLine = {
  productId: string;
  /** Ledger balance when the sheet was cut — for the printed sheet only. */
  expectedAtCut: Quantity;
  /** What was found. Null until someone counts it. */
  counted: Quantity | null;
  /** When it was last counted — the instant expected is measured at. */
  countedAt: string | null;
};

export type StockCountSheet = {
  id: string;
  /** `CNT-GWA-261117-093012` — written on the clipboard and quoted to HQ. */
  reference: string;
  branchId: string;
  /** "Full branch", "Dairy & eggs", "Cycle count — 12 lines". */
  scopeLabel: string;
  /**
   * Blind counts hide the expected figure while counting, so the counter
   * writes down what is on the shelf rather than confirming what the screen
   * says. Revealed at review.
   */
  blind: boolean;
  status: CountStatus;
  startedAt: string;
  startedById: string;
  startedByName: string;
  lines: CountLine[];
  postedAt: string | null;
  postedByName: string | null;
  closedNote: string | null;
};

/* ── Cutting a sheet ──────────────────────────────────────────────────────── */

/** Balance of one product in one branch as at an instant, inclusive. */
export function balanceAt(
  entries: readonly StockEntry[],
  branchId: string,
  productId: string,
  at: string,
): Quantity {
  let milli = 0;
  for (const e of entries) {
    if (e.branchId === branchId && e.productId === productId && e.at <= at) milli += e.delta.milli;
  }
  return { milli };
}

export function cutCountLines(
  entries: readonly StockEntry[],
  branchId: string,
  productIds: readonly string[],
  at: string,
): CountLine[] {
  const wanted = new Set(productIds);
  const totals = new Map<string, number>();
  for (const e of entries) {
    if (e.branchId !== branchId || !wanted.has(e.productId) || e.at > at) continue;
    totals.set(e.productId, (totals.get(e.productId) ?? 0) + e.delta.milli);
  }
  return productIds.map((productId) => ({
    productId,
    expectedAtCut: { milli: totals.get(productId) ?? 0 },
    counted: null,
    countedAt: null,
  }));
}

/**
 * The lines a cycle count should pick: the ones counted longest ago, never
 * counted first. Counting a slice of the shop every week finds problems while
 * they are small, without closing for a full stock-take.
 */
export function pickCycleLines(
  productIds: readonly string[],
  lastCountedAt: ReadonlyMap<string, string>,
  size: number,
): string[] {
  return [...productIds]
    .sort((a, b) => (lastCountedAt.get(a) ?? "").localeCompare(lastCountedAt.get(b) ?? "") || a.localeCompare(b))
    .slice(0, size);
}

/** When each product was last on a posted count — feeds `pickCycleLines`. */
export function lastCountedByProduct(sheets: readonly StockCountSheet[]): Map<string, string> {
  const last = new Map<string, string>();
  for (const sheet of sheets) {
    if (sheet.status !== "posted") continue;
    for (const line of sheet.lines) {
      if (!line.countedAt) continue;
      const seen = last.get(line.productId);
      if (!seen || line.countedAt > seen) last.set(line.productId, line.countedAt);
    }
  }
  return last;
}

/* ── Variance ─────────────────────────────────────────────────────────────── */

export type VarianceRow = {
  productId: string;
  /** Ledger balance at `countedAt`, or now when uncounted. */
  expected: Quantity;
  counted: Quantity | null;
  /** counted − expected. Null when uncounted. */
  variance: Quantity | null;
  /** Variance at cost. Negative is shrinkage. */
  value: Money;
  /**
   * Worth a second look before posting: off by more than 10% of what was
   * expected, or by anything at all when nothing was expected.
   */
  recount: boolean;
};

export type VarianceSummary = {
  lines: number;
  counted: number;
  uncounted: number;
  matched: number;
  short: number;
  over: number;
  /** Negative: value of what is missing. */
  shortValue: Money;
  /** Positive: value of what turned up. */
  overValue: Money;
  netValue: Money;
  /** Matched lines as basis points of counted lines. Null before any are counted. */
  accuracyBp: number | null;
  recounts: number;
};

export function countVariance(
  sheet: Pick<StockCountSheet, "branchId" | "lines">,
  entries: readonly StockEntry[],
  costOf: (productId: string) => Money,
  now: string,
): { rows: VarianceRow[]; summary: VarianceSummary } {
  const rows: VarianceRow[] = sheet.lines.map((line) => {
    const expected = balanceAt(entries, sheet.branchId, line.productId, line.countedAt ?? now);
    if (!line.counted) {
      return { productId: line.productId, expected, counted: null, variance: null, value: ZERO, recount: false };
    }
    const variance = subtractQty(line.counted, expected);
    const off = Math.abs(variance.milli);
    const recount = off > 0 && (expected.milli <= 0 || off * 10 > Math.abs(expected.milli));
    return {
      productId: line.productId,
      expected,
      counted: line.counted,
      variance,
      value: multiply(costOf(line.productId), toNumber(variance)),
      recount,
    };
  });

  let shortValue = ZERO;
  let overValue = ZERO;
  let matched = 0;
  let short = 0;
  let over = 0;
  let counted = 0;
  for (const row of rows) {
    if (!row.variance) continue;
    counted++;
    if (row.variance.milli === 0) matched++;
    else if (row.variance.milli < 0) {
      short++;
      shortValue = add(shortValue, row.value);
    } else {
      over++;
      overValue = add(overValue, row.value);
    }
  }

  return {
    rows,
    summary: {
      lines: rows.length,
      counted,
      uncounted: rows.length - counted,
      matched,
      short,
      over,
      shortValue,
      overValue,
      netValue: add(shortValue, overValue),
      accuracyBp: counted ? Math.round((matched * 10_000) / counted) : null,
      recounts: rows.filter((r) => r.recount).length,
    },
  };
}

/* ── Posting ──────────────────────────────────────────────────────────────── */

export type CountPosting = Omit<StockEntry, "id">;

/**
 * The movements a finished count appends: one `COUNT_ADJUSTMENT` per counted
 * line that differs, dated when the line was counted so the ledger replays to
 * the right figure at every instant. Matched and uncounted lines write nothing.
 */
export function planCountPosting(
  sheet: Pick<StockCountSheet, "branchId" | "reference" | "lines">,
  entries: readonly StockEntry[],
  staff: { id: string; name: string },
  now: string,
): CountPosting[] {
  const out: CountPosting[] = [];
  for (const line of sheet.lines) {
    if (!line.counted || !line.countedAt) continue;
    const expected = balanceAt(entries, sheet.branchId, line.productId, line.countedAt);
    const variance = subtractQty(line.counted, expected);
    if (variance.milli === 0) continue;
    out.push({
      branchId: sheet.branchId,
      productId: line.productId,
      delta: variance,
      reason: "COUNT_ADJUSTMENT",
      // Posted now, but describing the shelf as it was when counted. The
      // ledger's "at" is when the movement is true from.
      at: line.countedAt < now ? line.countedAt : now,
      staffId: staff.id,
      staffName: staff.name,
      ref: sheet.reference,
      note: `Stock count ${sheet.reference}`,
    });
  }
  return out;
}

/** Add to a line's count — the scan-to-count path. Never below zero. */
export function bumpCount(current: Quantity | null, by: Quantity): Quantity {
  const next = addQty(current ?? ZERO_QTY, by);
  return next.milli < 0 ? ZERO_QTY : next;
}
