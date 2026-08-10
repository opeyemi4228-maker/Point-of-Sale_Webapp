"use client";

import { useMemo } from "react";
import { ZERO_QTY } from "@/lib/domain/quantity";
import { isLow, isOversold } from "@/lib/domain/stock";
import { useBranchData, useChainEntries } from "@/lib/hooks/use-branch-data";
import { balancesForBranch } from "@/lib/domain/stock";
import { useWorkspaceBranches, useLiveProducts } from "@/lib/data/workspace-data";
import { useSessionStore } from "@/lib/stores/session";
import { todayInLagos } from "@/lib/utils/format-date";
import type { BadgeCounts } from "@/config/navigation";

/**
 * The counts on the sidebar — SPEC §15.
 *
 * Derived from the same ledger every screen reads, and deliberately not passed
 * down from a layout. The layouts used to hand the sidebar a figure out of a
 * fixture while the dashboard computed its own from the ledger, so the badge
 * said seven and the screen behind it said nine. A badge that disagrees with
 * the screen it points at is worse than no badge: it teaches people to ignore
 * it (CLAUDE.md rule 3, applied to the chrome as well as the data).
 *
 * The till gets no badges. A cashier cannot action low stock, and a number on
 * their rail they can do nothing about is noise on the one screen that must
 * stay quiet.
 */
export function useBadgeCounts(): BadgeCounts {
  const staff = useSessionStore((s) => s.session?.staff ?? null);
  const day = todayInLagos();

  const branch = useBranchData(staff?.branchId ?? null, day);
  const chain = useChainEntries();
  const live = useLiveProducts();
  const branches = useWorkspaceBranches();

  return useMemo(() => {
    if (!staff) return {};

    if (staff.role === "sales_person") return {};

    if (staff.role === "branch_manager") {
      const lowStock = live.filter((product) => {
        const onHand = branch.balances.get(product.id)?.onHand ?? ZERO_QTY;
        return !isOversold(onHand) && isLow(onHand, product.reorderLevel);
      }).length;

      return { lowStock };
    }

    // HQ counts branches with something wrong, not products: a chain-wide
    // product count says nothing about where to send someone.
    const exceptions = branches.filter((b) => {
      const balances = balancesForBranch(chain.entries, b.id);
      return live.some((product) => {
        const onHand = balances.get(product.id)?.onHand ?? ZERO_QTY;
        return isOversold(onHand) || isLow(onHand, product.reorderLevel);
      });
    }).length;

    return { exceptions };
  }, [staff, live, branches, branch.balances, chain.entries]);
}
