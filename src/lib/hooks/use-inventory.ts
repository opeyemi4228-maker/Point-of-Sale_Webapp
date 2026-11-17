"use client";

import { useMemo, useState } from "react";
import type { Money } from "@/lib/domain/money";
import { ZERO } from "@/lib/domain/money";
import { daysIn, shiftDay } from "@/lib/domain/inventory";
import { useWorkspaceBranches, useWorkspaceData } from "@/lib/data/workspace-data";
import { useLedgerHydrated, useLedgerStore } from "@/lib/stores/ledger";
import { useSessionStore } from "@/lib/stores/session";
import { lagosDayRange } from "@/lib/utils/format-date";
import type { BranchSummary } from "@/lib/data/repositories";
import type { Sale } from "@/types/sale";
import type { StockEntry } from "@/types/stock";
import type { Staff } from "@/types/staff";

/**
 * Shared plumbing for the inventory screens — deliveries, expiry, the stock
 * and sales report — which a branch manager and HQ both open.
 *
 * The difference between the two is scope, and only scope. A branch manager is
 * pinned to the branch on their session and is never offered a choice they do
 * not have; HQ picks a branch, or looks at the whole chain where that makes
 * sense. Row-level security still decides what either of them can actually
 * read (SPEC §8) — this only decides what the screen asks for.
 */

export const ALL_BRANCHES = "all" as const;
export type BranchScope = string | typeof ALL_BRANCHES;

export type InventoryScope = {
  staff: Staff | null;
  /** A branch id, or `"all"` for HQ looking across the chain. */
  branchId: BranchScope;
  /** The resolved branch, when one is selected. */
  branch: BranchSummary | null;
  /** HQ may choose; a manager may not. */
  canPick: boolean;
  setBranchId: (id: BranchScope) => void;
  branches: BranchSummary[];
};

export function useInventoryScope({ allowAll }: { allowAll: boolean }): InventoryScope {
  const staff = useSessionStore((s) => s.session?.staff ?? null);
  const branches = useWorkspaceBranches();
  const [picked, setPicked] = useState<BranchScope | null>(null);

  const pinned = staff?.branchId ?? null;
  const fallback: BranchScope = allowAll ? ALL_BRANCHES : (branches[0]?.id ?? ALL_BRANCHES);
  const branchId: BranchScope = pinned ?? picked ?? fallback;

  return {
    staff,
    branchId,
    branch: branches.find((b) => b.id === branchId) ?? null,
    canPick: !pinned && staff?.role === "general_admin",
    setBranchId: setPicked,
    branches,
  };
}

/**
 * Every stock movement and sale in scope, server rows plus this device's.
 *
 * The same merge `useBranchData` does, widened to "all branches" for HQ. Kept
 * as one function so the deliveries list, the register and the report cannot
 * disagree about which rows exist.
 */
export function useScopedLedger(branchId: BranchScope): {
  ready: boolean;
  entries: StockEntry[];
  sales: Sale[];
} {
  const ready = useLedgerHydrated();
  const { entries: serverEntries } = useWorkspaceData();
  const localMovements = useLedgerStore((s) => s.movements);
  const localSales = useLedgerStore((s) => s.sales);

  return useMemo(() => {
    const inScope = (row: { branchId: string }) =>
      branchId === ALL_BRANCHES || row.branchId === branchId;
    return {
      ready,
      entries: [
        ...serverEntries.filter(inScope),
        ...(ready ? localMovements.filter(inScope) : []),
      ],
      sales: ready ? localSales.filter(inScope) : [],
    };
  }, [ready, branchId, serverEntries, localMovements, localSales]);
}

/* ── Date ranges ──────────────────────────────────────────────────────────── */

export type RangePreset = "today" | "7d" | "30d" | "90d" | "all" | "custom";

export const RANGE_PRESETS: { value: Exclude<RangePreset, "custom">; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "all", label: "All time" },
];

/** How far back "All time" reaches. Earlier than any ledger row the chain has. */
const EPOCH_DAY = "2026-01-01";

export type DayRange = {
  preset: RangePreset;
  fromDay: string;
  toDay: string;
  /** Instants for the domain functions. */
  instants: { from: string; to: string };
  /** Every day in the window — for charts. Capped so "All time" stays legible. */
  days: string[];
  label: string;
};

export type DayRangeControl = {
  range: DayRange;
  setPreset: (preset: RangePreset) => void;
  /** Pick explicit days; switches the preset to "custom". */
  setCustom: (fromDay: string, toDay: string) => void;
  today: string;
};

export function useDayRange(today: string, initial: RangePreset = "30d"): DayRangeControl {
  const [preset, setPreset] = useState<RangePreset>(initial);
  const [custom, setCustomState] = useState({ from: shiftDay(today, -29), to: today });

  const range = useMemo<DayRange>(() => {
    let fromDay: string;
    let toDay = today;
    let label: string;

    if (preset === "custom") {
      // Accept the two ends in either order — a range picked backwards is
      // still obviously a range.
      const [a, b] = [custom.from, custom.to].sort();
      fromDay = a;
      toDay = b;
      label = `${a} to ${b}`;
    } else {
      const back = { today: 0, "7d": 6, "30d": 29, "90d": 89, all: null }[preset];
      fromDay = back === null ? EPOCH_DAY : shiftDay(today, -back);
      label = RANGE_PRESETS.find((p) => p.value === preset)?.label ?? "";
    }

    const all = daysIn(fromDay, toDay);
    return {
      preset,
      fromDay,
      toDay,
      instants: lagosDayRange(fromDay, toDay),
      days: all.length > 90 ? all.slice(-90) : all,
      label,
    };
  }, [preset, today, custom]);

  return {
    range,
    setPreset,
    setCustom: (from, to) => {
      setCustomState({ from, to });
      setPreset("custom");
    },
    today,
  };
}

/* ── Costs ────────────────────────────────────────────────────────────────── */

/** Catalog cost by product id, for valuing movements that did not record one. */
export function useCostOf(products: readonly { id: string; cost: Money }[]) {
  return useMemo(() => {
    const costs = new Map(products.map((p) => [p.id, p.cost]));
    return (productId: string) => costs.get(productId) ?? ZERO;
  }, [products]);
}

/* ── Document references ──────────────────────────────────────────────────── */

/**
 * `GRN-GWA-261117-143205-K7` — a human-readable reference for a delivery or a
 * write-off: kind, branch, Lagos date and time to the second.
 *
 * Readable on purpose. It gets written on the supplier's waybill and read out
 * over the phone to HQ, and a UUID survives neither.
 */
export function documentRef(prefix: "GRN" | "WO" | "ADJ", branchCode: string, at: Date): string {
  const lagos = new Date(at.getTime() + 3_600_000).toISOString();
  const day = lagos.slice(2, 10).replaceAll("-", "");
  const time = lagos.slice(11, 19).replaceAll(":", "");
  // Two deliveries received in the same second at one branch (two tablets,
  // two tabs) must not share a reference — the deliveries list groups by it.
  // Two letters on the end keep it unique without making it unreadable.
  const tag = Math.floor(Math.random() * 1296).toString(36).toUpperCase().padStart(2, "0");
  return `${prefix}-${branchCode}-${day}-${time}-${tag}`;
}
