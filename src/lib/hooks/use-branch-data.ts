"use client";

import { useMemo } from "react";
import { ZERO, add, sum, kobo, type Money } from "@/lib/domain/money";
import { balancesForBranch } from "@/lib/domain/stock";
import { itemCount, totalsByStaff, type SellerTotals } from "@/lib/domain/sale";
import { useLedgerHydrated, useLedgerStore } from "@/lib/stores/ledger";
import { useWorkspaceData } from "@/lib/data/workspace-data";
import { isoDay } from "@/lib/utils/format-date";
import type { Sale } from "@/types/sale";
import type { Product } from "@/types/catalog";
import type { StockEntry } from "@/types/stock";
import type { StockOnHand } from "@/types/stock";

/**
 * The one read path every workspace uses — SPEC §10, §11, §15.
 *
 * Server rows and locally-recorded rows are concatenated here and nowhere else.
 * Each screen doing its own merge is precisely how the three workspaces drifted
 * apart: they each picked a slightly different definition of "today" and of
 * which rows counted. One function, one answer.
 *
 * The server rows come from `WorkspaceShell`, which read them once for this
 * navigation under the signed-in actor's row-level security. The local rows are
 * whatever this device has rung since — the till writes locally first and syncs
 * behind (rule 8), so a sale is on the screen before it is on the server.
 *
 * `ready` is false until the persisted ledger has rehydrated. Screens must
 * render a settled state rather than server-only figures that jump a frame
 * later — see `useLedgerHydrated`.
 */

export type BranchData = {
  ready: boolean;
  /** Every stock movement for the branch, server plus local. */
  entries: StockEntry[];
  balances: Map<string, StockOnHand>;
  /** Sales rung on this device for the branch, newest first. */
  sales: Sale[];
  today: {
    sales: Money;
    transactions: number;
    averageBasket: Money;
    /** Countable items — see `itemCount`. Never a summed `Quantity`. */
    items: number;
  };
};

/** Re-exported so callers have one import for "the day this belongs to". */
export { isoDay as lagosDay } from "@/lib/utils/format-date";

export function useBranchData(branchId: string | null, day: string): BranchData {
  const ready = useLedgerHydrated();
  const { entries: serverEntries } = useWorkspaceData();
  const localSales = useLedgerStore((s) => s.sales);
  const localMovements = useLedgerStore((s) => s.movements);

  return useMemo(() => {
    if (!branchId) {
      return {
        ready,
        entries: [],
        balances: new Map(),
        sales: [],
        today: {
          sales: ZERO,
          transactions: 0,
          averageBasket: ZERO,
          items: 0,
        },
      };
    }

    const entries = [
      ...serverEntries.filter((entry) => entry.branchId === branchId),
      ...(ready ? localMovements.filter((entry) => entry.branchId === branchId) : []),
    ];

    const sales = (ready ? localSales : [])
      .filter((sale) => sale.branchId === branchId)
      .slice()
      .reverse();

    const todaySales = sales.filter((sale) => isoDay(sale.at) === day);
    const takings = sum(todaySales.map((sale) => sale.total));
    const items = todaySales.reduce(
      (running, sale) => running + itemCount(sale.lines),
      0,
    );

    return {
      ready,
      entries,
      balances: balancesForBranch(entries, branchId),
      sales,
      today: {
        sales: takings,
        transactions: todaySales.length,
        // Integer division on kobo, so the average is a real Money and never a
        // float that formats to a fraction of a kobo.
        averageBasket: todaySales.length
          ? kobo(Math.round(takings.kobo / todaySales.length))
          : ZERO,
        items,
      },
    };
  }, [branchId, day, ready, serverEntries, localSales, localMovements]);
}

/**
 * Sales per person across every branch — the HQ view (§15.3).
 *
 * Live rows only. An earlier version blended these with a static fixture, which
 * meant HQ showed takings for people who had not sold anything and missed the
 * ones who had; a screen that mixes real and invented rows without saying which
 * is which is worse than one that shows nothing.
 */
export function useSellerTotals(day: string): {
  ready: boolean;
  rows: SellerTotals[];
} {
  const ready = useLedgerHydrated();
  const sales = useLedgerStore((s) => s.sales);

  return useMemo(() => {
    if (!ready) return { ready, rows: [] };
    const onDay = sales.filter((sale) => isoDay(sale.at) === day);
    return {
      ready,
      rows: totalsByStaff(onDay).sort((a, b) => b.sales.kobo - a.sales.kobo),
    };
  }, [ready, sales, day]);
}

/** Chain-wide balances for every branch — HQ's stock view. */
export function useChainEntries(): { ready: boolean; entries: StockEntry[] } {
  const ready = useLedgerHydrated();
  const { entries: serverEntries } = useWorkspaceData();
  const localMovements = useLedgerStore((s) => s.movements);

  return useMemo(
    () => ({
      ready,
      entries: [...serverEntries, ...(ready ? localMovements : [])],
    }),
    [ready, serverEntries, localMovements],
  );
}

/**
 * Value of stock on hand, at cost.
 *
 * The catalog is a parameter rather than a module import: cost prices are the
 * one thing in the catalog a cashier must never see, so the caller has to have
 * been handed them deliberately.
 */
export function stockValue(
  balances: Map<string, StockOnHand>,
  products: readonly Product[],
): Money {
  let total = ZERO;
  for (const product of products) {
    const onHand = balances.get(product.id)?.onHand;
    if (!onHand) continue;
    total = add(total, kobo(Math.round((product.cost.kobo * onHand.milli) / 1000)));
  }
  return total;
}
