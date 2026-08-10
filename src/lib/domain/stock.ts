import {
  ZERO_QTY,
  addQty,
  compareQty,
  type Quantity,
} from "./quantity";
import type { StockEntry, StockOnHand } from "@/types/stock";
import type { StockReason } from "@/types/enums";

/**
 * The stock ledger — SPEC §10, CLAUDE.md rule 3.
 *
 * Every function here *derives*. Nothing in this module edits a balance,
 * because there is no balance to edit: on-hand is the sum of every movement
 * ever appended, and that is the only definition the system has. If a number on
 * a screen disagrees with the ledger, the number is wrong.
 *
 * Pure. No I/O, no clock, no React.
 */

/** On-hand for one product in one branch. */
export function balanceOf(
  entries: readonly StockEntry[],
  branchId: string,
  productId: string,
): Quantity {
  return entries.reduce(
    (total, entry) =>
      entry.branchId === branchId && entry.productId === productId
        ? addQty(total, entry.delta)
        : total,
    ZERO_QTY,
  );
}

/**
 * On-hand for every product in one branch, in a single pass.
 *
 * The obvious shape — map the catalog and call `balanceOf` per product — is
 * O(products × entries) and re-walks the whole ledger for every line on the
 * stock screen. This walks it once.
 */
export function balancesForBranch(
  entries: readonly StockEntry[],
  branchId: string,
): Map<string, StockOnHand> {
  const balances = new Map<string, StockOnHand>();

  for (const entry of entries) {
    if (entry.branchId !== branchId) continue;

    const current = balances.get(entry.productId);
    if (!current) {
      balances.set(entry.productId, {
        productId: entry.productId,
        onHand: entry.delta,
        lastMovedAt: entry.at,
      });
      continue;
    }

    current.onHand = addQty(current.onHand, entry.delta);
    // The ledger is not guaranteed to arrive sorted — an offline till syncs its
    // movements late (rule 8) — so take the max rather than trusting the last
    // row seen.
    if (!current.lastMovedAt || entry.at > current.lastMovedAt) {
      current.lastMovedAt = entry.at;
    }
  }

  return balances;
}

/** On-hand for one product across every branch, keyed by branch. */
export function balancesByBranch(
  entries: readonly StockEntry[],
  productId: string,
): Map<string, Quantity> {
  const balances = new Map<string, Quantity>();

  for (const entry of entries) {
    if (entry.productId !== productId) continue;
    balances.set(
      entry.branchId,
      addQty(balances.get(entry.branchId) ?? ZERO_QTY, entry.delta),
    );
  }

  return balances;
}

/** At or below the reorder level — SPEC §10.4. Equal counts as low. */
export const isLow = (onHand: Quantity, reorderLevel: Quantity): boolean =>
  compareQty(onHand, reorderLevel) <= 0;

/**
 * Negative on-hand, which is real and must stay visible.
 *
 * A till that kept selling while offline (rule 8) can push a line below zero.
 * That is not corruption — it is the ledger honestly reporting that more was
 * sold than the branch thought it had, and it is exactly the exception a
 * manager needs to see. Never clamp it to zero.
 */
export const isOversold = (onHand: Quantity): boolean => onHand.milli < 0;

/**
 * The movements behind one product's balance, newest first.
 *
 * This is the audit trail a manager opens when a figure looks wrong, so it
 * returns entries untouched and in full — no aggregation, no rounding.
 */
export function movementsFor(
  entries: readonly StockEntry[],
  branchId: string,
  productId: string,
): StockEntry[] {
  return entries
    .filter((e) => e.branchId === branchId && e.productId === productId)
    .sort((a, b) => b.at.localeCompare(a.at));
}

/** How a movement reads on a screen — SPEC §10.1. */
export const STOCK_REASON_LABEL: Record<StockReason, string> = {
  BRANCH_OPENED: "Opening stock",
  SALE: "Sold",
  REFUND: "Refunded",
  VOID: "Voided sale",
  PURCHASE_RECEIPT: "Received",
  TRANSFER_OUT: "Transferred out",
  TRANSFER_IN: "Transferred in",
  COUNT_ADJUSTMENT: "Count adjustment",
  DAMAGE: "Damaged",
  EXPIRY: "Expired",
  THEFT: "Theft",
  SAMPLE: "Sample",
  CORRECTION: "Correction",
  // The storefront draws on this same ledger, so a manager reading the
  // movements sees online picks in line with everything else rather than
  // wondering why the count is short.
  ONLINE_ORDER: "Picked for online order",
  ONLINE_RETURN: "Returned from online order",
};
