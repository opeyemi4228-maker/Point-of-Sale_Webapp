"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  addToBasket,
  basketTotals,
  removeLine,
  setLineQuantity,
  type BasketLine,
  type BasketTotals,
} from "@/lib/domain/basket";
import { ONE, addQty, units, type Quantity } from "@/lib/domain/quantity";
import type { Money } from "@/lib/domain/money";
import type { LoyaltyLookup } from "@/lib/data/repositories";
import type { Product } from "@/types/catalog";

/**
 * The open sale — SPEC §15.1.
 *
 * Lives on the till. Nothing here awaits the network: a scan lands in the
 * basket immediately and the receipt prints from local state, with the sale
 * syncing behind it (CLAUDE.md rule 8). A cashier with a queue never waits for
 * a round trip to see the tin they just passed over the glass.
 *
 * **Persisted to the device.** A browser that reloads mid-sale — a power blip,
 * a cable knocked out of a till PC, a cashier pressing F5 — used to drop a
 * forty-item basket on the floor while the customer stood there. The open
 * basket and the held sales are written to `localStorage` and read back when
 * the till mounts, so a reload costs a second, not a re-scan.
 *
 * All basket arithmetic is delegated to `lib/domain/basket` — this store holds
 * state and nothing else, so the rounding rules stay in one pure, testable
 * place rather than being reimplemented in a reducer.
 */

/** What the last action did, so the UI can confirm or refuse it — §15.1. */
export type ScanFeedback =
  | { kind: "added"; productName: string; quantity: number; at: number }
  | { kind: "unknown"; barcode: string; at: number }
  | { kind: "delisted"; barcode: string; at: number }
  | { kind: "removed"; productName: string; at: number }
  | { kind: "held"; at: number }
  | { kind: "recalled"; at: number };

/**
 * A sale parked to serve the next customer — the one who has forgotten their
 * purse, or gone back for the bread. Carries its loyalty card, because the
 * card belongs to the basket, not to whoever is at the counter when it resumes.
 */
export type HeldSale = {
  id: string;
  lines: BasketLine[];
  customer: LoyaltyLookup | null;
  heldAt: string;
  heldBy: string;
  total: Money;
  itemCount: number;
};

/** Enough to put a removed line back where it was. Never persisted. */
type Undo = { lines: BasketLine[]; at: number };

/** A held sale nobody resumes is a basket left on the counter; keep it short. */
export const MAX_HELD_SALES = 5;

type BasketState = {
  lines: BasketLine[];
  /** The loyalty card on the open sale. Null is the ordinary case (SPEC §11). */
  customer: LoyaltyLookup | null;
  /** Set while a weighed line is waiting for its weight. */
  awaitingWeight: Product | null;
  feedback: ScanFeedback | null;
  /** The line the last action changed — the tape scrolls to it and marks it. */
  touchedLineId: string | null;
  held: HeldSale[];
  undo: Undo | null;

  add: (product: Product, quantity?: Quantity) => void;
  addWeighed: (product: Product, kilos: number) => void;
  requestWeight: (product: Product) => void;
  cancelWeight: () => void;
  increment: (lineId: string) => void;
  decrement: (lineId: string) => void;
  setQuantity: (lineId: string, quantity: Quantity) => void;
  remove: (lineId: string) => void;
  undoRemove: () => void;
  setCustomer: (customer: LoyaltyLookup | null) => void;
  clear: () => void;
  /** Park the open sale. Returns false when the shelf is full. */
  hold: (heldBy: string) => boolean;
  /** Resume a held sale. An open sale, if any, swaps onto the shelf. */
  recall: (heldId: string, heldBy: string) => void;
  reportScan: (feedback: ScanFeedback) => void;
  totals: () => BasketTotals;
};

/**
 * Line ids — unique across reloads, not just within one page load.
 *
 * A plain counter was enough while the basket died with the tab. Now that it
 * survives a reload, a fresh `ln_1` could collide with a restored `ln_1` and the
 * stepper on one line would move the other. The time prefix keeps them apart
 * without needing `crypto.randomUUID`, which not every till browser has.
 */
let lineSequence = 0;
const nextLineId = () => `ln_${Date.now().toString(36)}_${++lineSequence}`;
const nextHeldId = () => `hold_${Date.now().toString(36)}_${++lineSequence}`;

function park(lines: BasketLine[], customer: LoyaltyLookup | null, heldBy: string): HeldSale {
  const totals = basketTotals(lines);
  return {
    id: nextHeldId(),
    lines,
    customer,
    heldAt: new Date().toISOString(),
    heldBy,
    total: totals.total,
    itemCount: totals.itemCount,
  };
}

/** The line a product landed on after an add — merged or appended. */
function lineFor(lines: readonly BasketLine[], product: Product): string | null {
  const matching = lines.filter((line) => line.product.id === product.id);
  return matching.at(-1)?.id ?? null;
}

export const useBasketStore = create<BasketState>()(
  persist(
    (set, get) => ({
      lines: [],
      customer: null,
      awaitingWeight: null,
      feedback: null,
      touchedLineId: null,
      held: [],
      undo: null,

      add: (product, quantity = ONE) =>
        set((state) => {
          const lines = addToBasket(state.lines, product, quantity, nextLineId);
          return {
            lines,
            awaitingWeight: null,
            touchedLineId: lineFor(lines, product),
            feedback: {
              kind: "added",
              productName: product.name,
              quantity: Math.round(quantity.milli / 1000),
              at: Date.now(),
            },
          };
        }),

      addWeighed: (product, kilos) =>
        set((state) => {
          const lines = addToBasket(state.lines, product, units(kilos), nextLineId);
          return {
            lines,
            awaitingWeight: null,
            touchedLineId: lineFor(lines, product),
            feedback: { kind: "added", productName: product.name, quantity: 1, at: Date.now() },
          };
        }),

      // A weighed line cannot be added by the scan alone — the label says which
      // product, the scale says how much. Scanning opens the weight prompt.
      requestWeight: (product) => set({ awaitingWeight: product }),
      cancelWeight: () => set({ awaitingWeight: null }),

      increment: (lineId) =>
        set((state) => ({
          touchedLineId: lineId,
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
          const leaving = line.quantity.milli <= ONE.milli;
          return {
            touchedLineId: leaving ? null : lineId,
            lines: setLineQuantity(state.lines, lineId, {
              milli: line.quantity.milli - ONE.milli,
            }),
            ...(leaving
              ? {
                  undo: { lines: state.lines, at: Date.now() },
                  feedback: { kind: "removed", productName: line.product.name, at: Date.now() },
                }
              : {}),
          };
        }),

      setQuantity: (lineId, quantity) =>
        set((state) => ({
          touchedLineId: lineId,
          lines: setLineQuantity(state.lines, lineId, quantity),
        })),

      // Removal is one tap at a 44px target beside the stepper, so it can always
      // be taken back. The whole basket is kept rather than the one line, so the
      // line returns to the same place on the tape and not the bottom.
      remove: (lineId) =>
        set((state) => {
          const line = state.lines.find((l) => l.id === lineId);
          if (!line) return state;
          return {
            lines: removeLine(state.lines, lineId),
            touchedLineId: null,
            undo: { lines: state.lines, at: Date.now() },
            feedback: { kind: "removed", productName: line.product.name, at: Date.now() },
          };
        }),

      undoRemove: () =>
        set((state) =>
          state.undo ? { lines: state.undo.lines, undo: null, feedback: null } : state,
        ),

      setCustomer: (customer) => set({ customer }),

      clear: () =>
        set({
          lines: [],
          customer: null,
          awaitingWeight: null,
          feedback: null,
          touchedLineId: null,
          undo: null,
        }),

      hold: (heldBy) => {
        const { lines, customer, held } = get();
        if (lines.length === 0 || held.length >= MAX_HELD_SALES) return false;
        set({
          held: [...held, park(lines, customer, heldBy)],
          lines: [],
          customer: null,
          touchedLineId: null,
          undo: null,
          feedback: { kind: "held", at: Date.now() },
        });
        return true;
      },

      recall: (heldId, heldBy) =>
        set((state) => {
          const target = state.held.find((sale) => sale.id === heldId);
          if (!target) return state;
          const rest = state.held.filter((sale) => sale.id !== heldId);
          // Swapping rather than refusing: a cashier recalling with something on
          // the tape means "put this one down and pick that one up".
          const shelf =
            state.lines.length > 0 ? [...rest, park(state.lines, state.customer, heldBy)] : rest;
          return {
            held: shelf,
            lines: target.lines,
            customer: target.customer,
            touchedLineId: null,
            undo: null,
            feedback: { kind: "recalled", at: Date.now() },
          };
        }),

      reportScan: (feedback) => set({ feedback }),

      totals: () => basketTotals(get().lines),
    }),
    {
      name: "swiftgrocers.basket",
      storage: createJSONStorage(() => localStorage),
      version: 1,
      // Read back in an effect on the till, never during render, so the server
      // HTML and the first client render agree (see `stores/session.ts`).
      skipHydration: true,
      // The sale, its card and the shelf. Feedback and undo are about the last
      // few seconds and mean nothing after a reload.
      partialize: (state) => ({
        lines: state.lines,
        customer: state.customer,
        held: state.held,
      }),
    },
  ),
);
