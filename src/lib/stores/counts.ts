"use client";

import { useSyncExternalStore } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Quantity } from "@/lib/domain/quantity";
import type { StockCountSheet } from "@/lib/domain/counting";

/**
 * Stock count sheets on this device — SPEC §10.3.
 *
 * A count is a working document while it is open: people key and re-key
 * figures as they walk the aisles, so the counted column is editable until the
 * sheet is posted. Posting is the one-way door — it appends the variances to
 * the stock ledger and freezes the sheet. An abandoned count is kept, marked
 * and explained, never removed (CLAUDE.md rule 4).
 *
 * Persisted locally like the ledger, so a count survives a dropped connection
 * or a closed tab halfway down aisle six (rule 8).
 */

type CountState = {
  sheets: Record<string, StockCountSheet>;
  start: (sheet: StockCountSheet) => void;
  setCounted: (id: string, productId: string, counted: Quantity | null, at: string) => void;
  /** A product found on the shelf that was not on the sheet. */
  addLine: (id: string, line: StockCountSheet["lines"][number]) => void;
  reveal: (id: string) => void;
  markPosted: (id: string, byName: string, at: string) => void;
  abandon: (id: string, byName: string, at: string, note: string) => void;
};

const editable = (sheet: StockCountSheet | undefined): sheet is StockCountSheet =>
  Boolean(sheet && sheet.status === "counting");

export const useCountStore = create<CountState>()(
  persist(
    (set) => ({
      sheets: {},

      start: (sheet) => set((s) => ({ sheets: { ...s.sheets, [sheet.id]: sheet } })),

      setCounted: (id, productId, counted, at) =>
        set((s) => {
          const sheet = s.sheets[id];
          if (!editable(sheet)) return s;
          return {
            sheets: {
              ...s.sheets,
              [id]: {
                ...sheet,
                lines: sheet.lines.map((l) =>
                  l.productId === productId ? { ...l, counted, countedAt: counted ? at : null } : l,
                ),
              },
            },
          };
        }),

      addLine: (id, line) =>
        set((s) => {
          const sheet = s.sheets[id];
          if (!editable(sheet) || sheet.lines.some((l) => l.productId === line.productId)) return s;
          return { sheets: { ...s.sheets, [id]: { ...sheet, lines: [...sheet.lines, line] } } };
        }),

      reveal: (id) =>
        set((s) => {
          const sheet = s.sheets[id];
          if (!editable(sheet)) return s;
          return { sheets: { ...s.sheets, [id]: { ...sheet, blind: false } } };
        }),

      markPosted: (id, byName, at) =>
        set((s) => {
          const sheet = s.sheets[id];
          if (!editable(sheet)) return s;
          return {
            sheets: { ...s.sheets, [id]: { ...sheet, status: "posted", postedAt: at, postedByName: byName, blind: false } },
          };
        }),

      abandon: (id, byName, at, note) =>
        set((s) => {
          const sheet = s.sheets[id];
          if (!editable(sheet)) return s;
          return {
            sheets: {
              ...s.sheets,
              [id]: { ...sheet, status: "abandoned", postedAt: at, postedByName: byName, closedNote: note },
            },
          };
        }),
    }),
    {
      name: "swiftgrocers.counts",
      storage: createJSONStorage(() => localStorage),
      version: 1,
    },
  ),
);

export function useCountsHydrated(): boolean {
  return useSyncExternalStore(
    (onChange) => useCountStore.persist.onFinishHydration(onChange),
    () => useCountStore.persist.hasHydrated(),
    () => false,
  );
}
