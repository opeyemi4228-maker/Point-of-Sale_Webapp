"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { useSyncExternalStore } from "react";
import type { Sale } from "@/types/sale";
import type { StockEntry } from "@/types/stock";

/**
 * The shared local ledger — the spine the three workspaces hang off.
 *
 * Before this existed, the till settled a sale and nothing else in the system
 * knew: stock did not move, the manager's dashboard did not change, and HQ's
 * sales-per-person was a fixture unrelated to anyone actually selling. Three
 * screens, three separate truths. This is the one place a sale is recorded, and
 * every other screen reads back out of it.
 *
 * **Append-only, like the server ledger it stands in for.** There is no
 * `update` and no `delete` on this store: a mistake is corrected by appending
 * the opposite movement (CLAUDE.md rules 3 and 4), so the store exposes only
 * verbs that add.
 *
 * Persisted to `localStorage` because that is what makes it feel like one
 * system: a cashier rings a sale, the manager opens their dashboard in another
 * tab, and the figures have moved. It is also the honest shape of the real
 * thing — the till writes locally and syncs behind (rule 8). Dexie replaces
 * this storage when the sync queue lands; nothing above this file changes.
 */

type LedgerState = {
  /** Sales rung on this device, newest last. */
  sales: Sale[];
  /** Stock movements recorded on this device, on top of what the server sent. */
  movements: StockEntry[];
  /** Per-branch, per-day receipt counter — SPEC §12. */
  sequences: Record<string, number>;

  /** Reserve the next receipt number for a branch on a day. */
  nextSequence: (branchId: string, isoDay: string) => number;
  recordSale: (sale: Sale, movements: Omit<StockEntry, "id">[]) => void;
  /**
   * Append stock movements that are not a sale: deliveries, write-offs,
   * adjustments and their reversals. Returns the entries as stored, ids
   * included, so a screen can point at what it just wrote.
   */
  appendMovements: (movements: Omit<StockEntry, "id">[]) => StockEntry[];
  /** Development affordance only — clears the device, never the server. */
  reset: () => void;
};

const LEDGER_KEY = "swiftgrocers.ledger";

let movementSequence = 0;
const nextMovementId = () =>
  `stk_dev_${Date.now().toString(36)}_${++movementSequence}`;

export const useLedgerStore = create<LedgerState>()(
  persist(
    (set, get) => ({
      sales: [],
      movements: [],
      sequences: {},

      nextSequence: (branchId, isoDay) => {
        const key = `${branchId}:${isoDay}`;
        const next = (get().sequences[key] ?? 0) + 1;
        set((state) => ({ sequences: { ...state.sequences, [key]: next } }));
        return next;
      },

      recordSale: (sale, movements) =>
        set((state) => ({
          sales: [...state.sales, sale],
          movements: [
            ...state.movements,
            ...movements.map((movement) => ({ ...movement, id: nextMovementId() })),
          ],
        })),

      appendMovements: (movements) => {
        const written = movements.map((movement) => ({ ...movement, id: nextMovementId() }));
        set((state) => ({ movements: [...state.movements, ...written] }));
        return written;
      },

      reset: () => set({ sales: [], movements: [], sequences: {} }),
    }),
    {
      name: LEDGER_KEY,
      storage: createJSONStorage(() => localStorage),
      version: 1,
    },
  ),
);

/**
 * Keep tabs on one device in step.
 *
 * Persist writes the whole store, so a tab holding an older copy would
 * overwrite movements another tab had appended since — a sale rung at the till
 * vanishing because a manager received a delivery in a tab opened earlier.
 * That is an edit to an append-only ledger (rules 3 and 4). Re-reading storage
 * whenever another tab writes means every append lands on the latest copy.
 */
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === LEDGER_KEY) void useLedgerStore.persist.rehydrate();
  });
}

/**
 * Whether the persisted ledger has been read back off the device yet.
 *
 * Every screen that mixes local rows with server rows must wait for this.
 * Rendering before rehydration shows the server figures for one frame and then
 * jumps when the local ones arrive — which on a stock screen reads as the
 * number changing by itself, and is exactly the kind of thing that makes people
 * stop trusting a POS.
 */
export function useLedgerHydrated(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const unsub = useLedgerStore.persist.onFinishHydration(onChange);
      return unsub;
    },
    () => useLedgerStore.persist.hasHydrated(),
    () => false,
  );
}
