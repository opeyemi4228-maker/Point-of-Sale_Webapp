"use client";

import { useMemo } from "react";
import { shiftDay } from "@/lib/domain/inventory";
import { ZERO_QTY, addQty, type Quantity } from "@/lib/domain/quantity";
import { lagosDayRange } from "@/lib/utils/format-date";
import type { StockReason } from "@/types/enums";
import type { StockEntry } from "@/types/stock";

/**
 * Everything the product database says about a line's stock, in one walk of
 * the ledger: on hand (per branch and in total), units sold in the last 30
 * days, and when it was last received and last sold.
 *
 * Derived, never stored (CLAUDE.md rule 3) — the same movements the stock
 * screen sums, so the two screens cannot disagree.
 */

/** Movements that are trade with a customer, net of what came back. */
const SOLD: ReadonlySet<StockReason> = new Set(["SALE", "ONLINE_ORDER", "REFUND", "VOID"]);

export type ProductStock = {
  onHand: Quantity;
  byBranch: Map<string, Quantity>;
  /** Positive: units that left with customers in the window. */
  sold30: Quantity;
  lastReceivedAt: string | null;
  lastSoldAt: string | null;
};

export const EMPTY_STOCK: ProductStock = {
  onHand: ZERO_QTY,
  byBranch: new Map(),
  sold30: ZERO_QTY,
  lastReceivedAt: null,
  lastSoldAt: null,
};

export function useProductStock(entries: readonly StockEntry[], today: string) {
  return useMemo(() => {
    const since = lagosDayRange(shiftDay(today, -29), today).from;
    const stats = new Map<string, ProductStock>();

    for (const e of entries) {
      let s = stats.get(e.productId);
      if (!s) {
        s = { onHand: ZERO_QTY, byBranch: new Map(), sold30: ZERO_QTY, lastReceivedAt: null, lastSoldAt: null };
        stats.set(e.productId, s);
      }
      s.onHand = addQty(s.onHand, e.delta);
      s.byBranch.set(e.branchId, addQty(s.byBranch.get(e.branchId) ?? ZERO_QTY, e.delta));

      if (SOLD.has(e.reason)) {
        if (e.at >= since) s.sold30 = { milli: s.sold30.milli - e.delta.milli };
        if (e.reason === "SALE" || e.reason === "ONLINE_ORDER") {
          if (!s.lastSoldAt || e.at > s.lastSoldAt) s.lastSoldAt = e.at;
        }
      }
      if (e.reason === "PURCHASE_RECEIPT" && (!s.lastReceivedAt || e.at > s.lastReceivedAt)) {
        s.lastReceivedAt = e.at;
      }
    }
    return stats;
  }, [entries, today]);
}

/**
 * Days the shelf lasts at the last 30 days' pace. Null when nothing sold —
 * "infinite cover" is not a number worth printing.
 */
export function daysOfCover(onHand: Quantity, sold30: Quantity): number | null {
  if (sold30.milli <= 0) return null;
  if (onHand.milli <= 0) return 0;
  return Math.floor((onHand.milli * 30) / sold30.milli);
}
