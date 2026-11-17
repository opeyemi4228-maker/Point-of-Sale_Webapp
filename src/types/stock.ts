import type { Money } from "@/lib/domain/money";
import type { Quantity } from "@/lib/domain/quantity";
import type { StockReason } from "./enums";

/**
 * One movement in the stock ledger — SPEC §10.
 *
 * The ledger is append-only (CLAUDE.md rule 3). There is no `quantity` column
 * anywhere that a screen may set: to correct a mistake you append the opposite
 * movement with reason `CORRECTION`, which leaves both the error and the fix on
 * the record. Nothing here is ever updated or deleted, so every entry is
 * `readonly` and the type has no setters to tempt anyone.
 */
export type StockEntry = {
  readonly id: string;
  readonly branchId: string;
  readonly productId: string;
  /** Signed. Positive puts stock in, negative takes it out. */
  readonly delta: Quantity;
  readonly reason: StockReason;
  /** ISO instant, UTC. Formatted to Lagos at the presentation layer only. */
  readonly at: string;
  /** Who caused it. A sale records the cashier, a receipt the manager. */
  readonly staffId: string;
  readonly staffName: string;
  /** The sale, transfer or purchase order this movement belongs to. */
  readonly ref?: string;
  readonly note?: string;

  /* ── Inbound batch detail — receipts only ──────────────────────────────── */

  /**
   * Where a delivery came from. Present on `PURCHASE_RECEIPT` movements so a
   * manager can answer "what did the warehouse send us this month" without a
   * separate document store.
   */
  readonly source?: StockSource;
  /**
   * What was actually paid per unit on this delivery. Falls back to the
   * catalog cost when absent (opening stock, fixture rows).
   */
  readonly unitCost?: Money;
  /**
   * The batch's best-before, as a Lagos calendar day (`2026-11-30`). On a
   * receipt it drives the expiry screen (see `batchesOnHand`); on an `EXPIRY`
   * write-off it records which batch was pulled, so the register can say how
   * long after its date it came off the shelf.
   */
  readonly expiresOn?: string;
  /**
   * The purchase order this receipt was delivered against, when there was
   * one. How much of an order has landed is the sum of these — never a number
   * kept on the order itself.
   */
  readonly orderRef?: string;
};

/** Who stock was bought from — SPEC §7.7. */
export type StockSource = {
  readonly kind: "warehouse" | "supplier";
  /** "Swiftgrocers Central Warehouse", "Jos Fresh Farms Co-op". */
  readonly name: string;
  /** Their paperwork: invoice, waybill or delivery-note number. */
  readonly document?: string;
};

/**
 * A derived on-hand figure. Never stored — always computed from the ledger, so
 * it cannot drift away from the movements that produced it.
 */
export type StockOnHand = {
  productId: string;
  onHand: Quantity;
  /** The most recent movement, for "last counted / last received" columns. */
  lastMovedAt: string | null;
};

/** On-hand for one product across the chain — the HQ view. */
export type ChainStockRow = {
  productId: string;
  sku: string;
  name: string;
  categoryName: string;
  unit: string;
  total: Quantity;
  reorderLevel: Quantity;
  /** Per-branch split, ordered by branch name. */
  byBranch: { branchId: string; branchName: string; onHand: Quantity }[];
  /** How many branches are at or below their reorder level. */
  branchesLow: number;
};
