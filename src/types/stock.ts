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
