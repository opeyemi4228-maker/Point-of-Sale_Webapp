"use client";

import { create } from "zustand";
import {
  addToBasket,
  basketTotals,
  removeLine,
  setLineQuantity,
  type BasketLine,
  type BasketTotals,
} from "@/lib/domain/basket";
import { ONE, addQty, units, type Quantity } from "@/lib/domain/quantity";
import type { Product } from "@/types/catalog";

/**
 * The open sale — SPEC §15.1.
 *
 * Lives entirely in memory on the till. Nothing here awaits the network: a scan
 * lands in the basket immediately and the receipt prints from local state, with
 * the sale syncing behind it (CLAUDE.md rule 8). A cashier with a queue never
 * waits for a round trip to see the tin they just passed over the glass.
 *
 * All basket arithmetic is delegated to `lib/domain/basket` — this store holds
 * state and nothing else, so the rounding rules stay in one pure, testable
 * place rather than being reimplemented in a reducer.
 */

/** What the last scan did, so the UI can confirm or refuse it — §15.1. */
export type ScanFeedback =
  | { kind: "added"; productName: string; at: number }
  | { kind: "unknown"; barcode: string; at: number }
  | { kind: "delisted"; barcode: string; at: number };

type BasketState = {
  lines: BasketLine[];
  /** Set while a weighed line is waiting for its weight. */
  awaitingWeight: Product | null;
  feedback: ScanFeedback | null;

  add: (product: Product, quantity?: Quantity) => void;
  addWeighed: (product: Product, kilos: number) => void;
  requestWeight: (product: Product) => void;
  cancelWeight: () => void;
  increment: (lineId: string) => void;
  decrement: (lineId: string) => void;
  setQuantity: (lineId: string, quantity: Quantity) => void;
  remove: (lineId: string) => void;
  clear: () => void;
  reportScan: (feedback: ScanFeedback) => void;
  totals: () => BasketTotals;
};

/**
 * Line ids. `crypto.randomUUID` is not available on every till browser and is
 * not needed — a line id only has to be unique within one open basket, and a
 * counter is both sufficient and stable across re-renders.
 */
let lineSequence = 0;
const nextLineId = () => `ln_${++lineSequence}`;

export const useBasketStore = create<BasketState>((set, get) => ({
  lines: [],
  awaitingWeight: null,
  feedback: null,

  add: (product, quantity = ONE) =>
    set((state) => ({
      lines: addToBasket(state.lines, product, quantity, nextLineId),
      awaitingWeight: null,
      feedback: { kind: "added", productName: product.name, at: Date.now() },
    })),

  addWeighed: (product, kilos) =>
    set((state) => ({
      lines: addToBasket(state.lines, product, units(kilos), nextLineId),
      awaitingWeight: null,
      feedback: { kind: "added", productName: product.name, at: Date.now() },
    })),

  // A weighed line cannot be added by the scan alone — the label says which
  // product, the scale says how much. Scanning opens the weight prompt.
  requestWeight: (product) => set({ awaitingWeight: product }),
  cancelWeight: () => set({ awaitingWeight: null }),

  increment: (lineId) =>
    set((state) => ({
      lines: state.lines.map((line) =>
        line.id === lineId ? { ...line, quantity: addQty(line.quantity, ONE) } : line,
      ),
    })),

  // Stepping a line down to zero removes it, which is what pressing minus on a
  // quantity of one means. The rule lives in the domain, not here.
  decrement: (lineId) =>
    set((state) => {
      const line = state.lines.find((l) => l.id === lineId);
      if (!line) return state;
      return {
        lines: setLineQuantity(state.lines, lineId, {
          milli: line.quantity.milli - ONE.milli,
        }),
      };
    }),

  setQuantity: (lineId, quantity) =>
    set((state) => ({ lines: setLineQuantity(state.lines, lineId, quantity) })),

  remove: (lineId) => set((state) => ({ lines: removeLine(state.lines, lineId) })),

  clear: () => set({ lines: [], awaitingWeight: null, feedback: null }),

  reportScan: (feedback) => set({ feedback }),

  totals: () => basketTotals(get().lines),
}));
