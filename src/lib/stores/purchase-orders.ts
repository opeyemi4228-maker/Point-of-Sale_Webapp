"use client";

import { useMemo } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { useWorkspaceData } from "@/lib/data/workspace-data";
import { useLedgerHydrated } from "@/lib/stores/ledger";
import type { PurchaseOrder, PurchaseOrderEvent } from "@/types/operations";

/**
 * Purchase orders raised or changed on this device — SPEC §7.7.
 *
 * Same shape as the ledger store: written locally first, synced behind
 * (CLAUDE.md rule 8). An order is a document with a short life — draft, sent,
 * maybe cancelled — so this keeps the latest version of each order this device
 * has touched, plus an append-only trail of what happened to it. The trail is
 * never edited; it is the answer to "who cancelled this, and why".
 *
 * What has *arrived* against an order is not here. That is the stock ledger.
 */

const PO_STORE_KEY = "swiftgrocers.purchase-orders";

type PurchaseOrderState = {
  /** Latest version of each order touched on this device, by id. */
  versions: Record<string, PurchaseOrder>;
  events: PurchaseOrderEvent[];
  save: (order: PurchaseOrder, event: Omit<PurchaseOrderEvent, "orderId">) => void;
};

export const usePurchaseOrderStore = create<PurchaseOrderState>()(
  persist(
    (set) => ({
      versions: {},
      events: [],
      save: (order, event) =>
        set((state) => ({
          versions: { ...state.versions, [order.id]: order },
          events: [...state.events, { ...event, orderId: order.id }],
        })),
    }),
    {
      name: PO_STORE_KEY,
      storage: createJSONStorage(() => localStorage),
      version: 1,
    },
  ),
);

/**
 * Every order in scope — the server's, with this device's versions laid over
 * them — newest first, each with its trail.
 *
 * Waits for the ledger to rehydrate (both stores load from the same storage in
 * the same tick) so an order never shows as "sent" for a frame and then jumps
 * to "received" when its receipts arrive.
 */
export function usePurchaseOrders(branchId: string | "all"): {
  ready: boolean;
  orders: PurchaseOrder[];
  eventsFor: (orderId: string) => PurchaseOrderEvent[];
} {
  const ready = useLedgerHydrated();
  const { orders: serverOrders } = useWorkspaceData();
  const versions = usePurchaseOrderStore((s) => s.versions);
  const events = usePurchaseOrderStore((s) => s.events);

  return useMemo(() => {
    const merged = new Map(serverOrders.map((o) => [o.id, o]));
    if (ready) {
      for (const [id, local] of Object.entries(versions)) {
        const server = merged.get(id);
        merged.set(id, server ? newer(server, local) : local);
      }
    }

    const orders = [...merged.values()]
      .filter((o) => branchId === "all" || o.branchId === branchId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const byOrder = new Map<string, PurchaseOrderEvent[]>();
    for (const event of ready ? events : []) {
      const list = byOrder.get(event.orderId) ?? [];
      list.push(event);
      byOrder.set(event.orderId, list);
    }

    return { ready, orders, eventsFor: (id: string) => byOrder.get(id) ?? [] };
  }, [ready, serverOrders, versions, events, branchId]);
}

/**
 * Which copy of an order to show when this device and the server both have
 * one. An order only ever moves forward — draft, then sent, then cancelled —
 * so the copy further along wins. A device that last saw a draft must not
 * bring an order back to life after somebody else sent or cancelled it.
 */
function newer(server: PurchaseOrder, local: PurchaseOrder): PurchaseOrder {
  const stage = (o: PurchaseOrder) => (o.cancelledAt ? 2 : o.sentAt ? 1 : 0);
  return stage(server) > stage(local) ? server : local;
}

/**
 * The next order reference for a branch: `PO-GWA-0123`, one past the highest
 * number in use anywhere in the chain, so references never repeat between
 * branches either.
 */
export function nextOrderReference(all: readonly PurchaseOrder[], branchCode: string): string {
  const highest = all.reduce((max, o) => {
    const match = /(\d+)$/.exec(o.reference);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `PO-${branchCode}-${String(highest + 1).padStart(4, "0")}`;
}

// Another tab wrote — read it back before this tab writes over it.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === PO_STORE_KEY) void usePurchaseOrderStore.persist.rehydrate();
  });
}
