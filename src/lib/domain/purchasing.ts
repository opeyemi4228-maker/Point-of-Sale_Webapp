import { ZERO, multiply, sum, type Money } from "./money";
import { units, type Quantity } from "./quantity";
import { daysBetween, isIsoDay } from "./inventory";
import type { PurchaseOrder } from "@/types/operations";
import type { StockEntry } from "@/types/stock";
import type { SoldBy } from "@/types/enums";

/**
 * Purchase orders — SPEC §7.7.
 *
 * An order is a promise; a receipt is stock. This module keeps them apart and
 * derives one from the other: how much of an order has arrived is the sum of
 * the ledger receipts that name it, and the order's status follows from that.
 * There is no "received quantity" field anywhere for a screen to set.
 *
 * Pure. No I/O, no clock — "today" is always a parameter.
 */

export type OrderStatus =
  | "draft"
  | "sent"
  | "partially_received"
  | "received"
  | "cancelled";

export type LineProgress = {
  productId: string;
  ordered: Quantity;
  received: Quantity;
  /** Never negative. An over-delivery shows as zero outstanding, not minus. */
  outstanding: Quantity;
  unitCost: Money;
  orderedValue: Money;
  receivedValue: Money;
};

export type OrderProgress = {
  status: OrderStatus;
  lines: LineProgress[];
  orderedValue: Money;
  receivedValue: Money;
  outstandingValue: Money;
  /** Fraction of ordered units that have arrived, 0–1, by value. */
  fulfilment: number;
  /** Sent, not complete, and past the promised day. */
  overdue: boolean;
  /** Days late, when overdue. */
  daysLate: number;
  /** The receipts against this order, oldest first. */
  receipts: StockEntry[];
};

/**
 * Where an order stands, from the order and the ledger.
 *
 * Received value is at the price actually paid on each receipt, falling back
 * to the order's agreed price — a supplier who invoices above the order shows
 * up as a difference rather than being quietly absorbed.
 */
export function orderProgress(
  order: PurchaseOrder,
  entries: readonly StockEntry[],
  today: string,
): OrderProgress {
  const receipts = entries
    .filter(
      (e) =>
        e.reason === "PURCHASE_RECEIPT" &&
        e.branchId === order.branchId &&
        // `orderRef` where the ledger has the column; otherwise a receipt whose
        // own reference is the order's (how the database path records it).
        (e.orderRef === order.reference || (!e.orderRef && e.ref === order.reference)),
    )
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  const lines: LineProgress[] = order.lines.map((line) => {
    const mine = receipts.filter((r) => r.productId === line.productId);
    const receivedMilli = mine.reduce((n, r) => n + r.delta.milli, 0);
    return {
      productId: line.productId,
      ordered: line.quantity,
      received: { milli: receivedMilli },
      outstanding: { milli: Math.max(0, line.quantity.milli - receivedMilli) },
      unitCost: line.unitCost,
      orderedValue: multiply(line.unitCost, line.quantity.milli / 1000),
      receivedValue: sum(
        mine.map((r) => multiply(r.unitCost ?? line.unitCost, r.delta.milli / 1000)),
      ),
    };
  });

  const orderedValue = sum(lines.map((l) => l.orderedValue));
  const receivedValue = sum(lines.map((l) => l.receivedValue));
  const outstandingValue = sum(
    lines.map((l) => multiply(l.unitCost, l.outstanding.milli / 1000)),
  );

  const anyReceived = lines.some((l) => l.received.milli > 0);
  const allReceived = lines.length > 0 && lines.every((l) => l.outstanding.milli === 0);

  const status: OrderStatus = order.cancelledAt
    ? "cancelled"
    : allReceived
      ? "received"
      : anyReceived
        ? "partially_received"
        : order.sentAt
          ? "sent"
          : "draft";

  const open = status === "sent" || status === "partially_received";
  const daysLate =
    open && order.expectedOn ? Math.max(0, daysBetween(order.expectedOn, today)) : 0;

  return {
    status,
    lines,
    orderedValue,
    receivedValue,
    outstandingValue: open ? outstandingValue : ZERO,
    fulfilment: orderedValue.kobo
      ? Math.min(1, (orderedValue.kobo - outstandingValue.kobo) / orderedValue.kobo)
      : 0,
    overdue: daysLate > 0,
    daysLate,
    receipts,
  };
}

/** Orders that can still receive stock. */
export const isOpen = (status: OrderStatus) =>
  status === "sent" || status === "partially_received";

/* ── Raising an order ─────────────────────────────────────────────────────── */

export type OrderDraftLine = {
  productId: string;
  productName: string;
  soldBy: SoldBy;
  quantity: number;
  unitCost: Money;
};

export type OrderDraft = {
  supplier: string;
  expectedOn: string;
  lines: readonly OrderDraftLine[];
  today: string;
};

export type OrderProblem = {
  field: "supplier" | "expectedOn" | "lines" | "quantity" | "unitCost";
  line?: number;
  message: string;
};

/**
 * Check an order before it is saved. A draft may be incomplete about the
 * delivery date; it may not be about what is being bought.
 */
export function planOrder(
  draft: OrderDraft,
): { ok: true; lines: PurchaseOrder["lines"] } | { ok: false; problems: OrderProblem[] } {
  const problems: OrderProblem[] = [];

  if (!draft.supplier.trim()) {
    problems.push({ field: "supplier", message: "Say who the order is going to." });
  }
  if (draft.expectedOn) {
    if (!isIsoDay(draft.expectedOn)) {
      problems.push({ field: "expectedOn", message: "That delivery date is not a real date." });
    } else if (daysBetween(draft.today, draft.expectedOn) < 0) {
      problems.push({ field: "expectedOn", message: "The delivery date is in the past." });
    }
  }
  if (draft.lines.length === 0) {
    problems.push({ field: "lines", message: "Add at least one product to the order." });
  }

  const seen = new Set<string>();
  draft.lines.forEach((line, index) => {
    if (seen.has(line.productId)) {
      problems.push({
        field: "lines",
        line: index,
        message: `${line.productName} is on the order twice. Combine the lines.`,
      });
    }
    seen.add(line.productId);

    if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
      problems.push({ field: "quantity", line: index, message: `${line.productName}: enter a quantity above zero.` });
    } else if (line.soldBy === "unit" && !Number.isInteger(line.quantity)) {
      problems.push({ field: "quantity", line: index, message: `${line.productName}: ordered in whole units.` });
    }
    if (line.unitCost.kobo <= 0) {
      problems.push({ field: "unitCost", line: index, message: `${line.productName}: enter the agreed unit cost.` });
    }
  });

  if (problems.length > 0) return { ok: false, problems };

  return {
    ok: true,
    lines: draft.lines.map((line) => ({
      productId: line.productId,
      quantity: units(line.quantity),
      unitCost: line.unitCost,
    })),
  };
}

/* ── Receiving against an order ───────────────────────────────────────────── */

export type ReceiveLineInput = {
  productId: string;
  productName: string;
  soldBy: SoldBy;
  /** As keyed. Zero or blank means "none of this line arrived". */
  quantity: number;
  unitCost: Money;
  expiresOn: string;
};

export type ReceiveProblem = {
  line?: number;
  field: "quantity" | "unitCost" | "expiresOn" | "lines";
  message: string;
};

/**
 * Validate a delivery against what is still outstanding.
 *
 * Over-delivery is refused rather than absorbed. Extra stock the branch did
 * not order is a conversation with the supplier, and receiving it against the
 * order would make the order look complete at a price nobody agreed.
 */
export function planOrderReceipt(
  progress: OrderProgress,
  inputs: readonly ReceiveLineInput[],
  today: string,
):
  | { ok: true; lines: { productId: string; quantity: Quantity; unitCost: Money; expiresOn?: string }[] }
  | { ok: false; problems: ReceiveProblem[] } {
  const problems: ReceiveProblem[] = [];
  const lines: { productId: string; quantity: Quantity; unitCost: Money; expiresOn?: string }[] = [];

  if (!isOpen(progress.status)) {
    return {
      ok: false,
      problems: [{ field: "lines", message: "Only a sent order that is not yet complete can be received." }],
    };
  }

  inputs.forEach((input, index) => {
    if (!Number.isFinite(input.quantity) || input.quantity === 0) return;
    const line = progress.lines.find((l) => l.productId === input.productId);
    if (!line) {
      problems.push({ field: "lines", line: index, message: `${input.productName} is not on this order.` });
      return;
    }
    if (input.quantity < 0) {
      problems.push({ field: "quantity", line: index, message: `${input.productName}: a quantity cannot be negative.` });
      return;
    }
    if (input.soldBy === "unit" && !Number.isInteger(input.quantity)) {
      problems.push({ field: "quantity", line: index, message: `${input.productName}: whole units only.` });
      return;
    }
    const qty = units(input.quantity);
    if (qty.milli > line.outstanding.milli) {
      problems.push({
        field: "quantity",
        line: index,
        message: `${input.productName}: only ${line.outstanding.milli / 1000} still outstanding. Receive any extra as a separate delivery.`,
      });
      return;
    }
    if (input.unitCost.kobo < 0) {
      problems.push({ field: "unitCost", line: index, message: `${input.productName}: enter a unit cost of zero or more.` });
      return;
    }
    const expiresOn = input.expiresOn.trim();
    if (expiresOn && (!isIsoDay(expiresOn) || daysBetween(today, expiresOn) <= 0)) {
      problems.push({
        field: "expiresOn",
        line: index,
        message: `${input.productName}: best-before must be a real date after today — refuse expired stock at the door.`,
      });
      return;
    }
    lines.push({
      productId: input.productId,
      quantity: qty,
      unitCost: input.unitCost,
      ...(expiresOn ? { expiresOn } : {}),
    });
  });

  if (problems.length === 0 && lines.length === 0) {
    problems.push({ field: "lines", message: "Enter the quantity that arrived on at least one line." });
  }

  return problems.length > 0 ? { ok: false, problems } : { ok: true, lines };
}

/* ── Reorder suggestions ──────────────────────────────────────────────────── */

/**
 * How much to order to bring a line back up: twice the reorder level, less
 * what is on hand and what is already on its way. Zero when nothing is needed.
 *
 * Counting stock already on order matters — without it, every manager who
 * opens the screen before the van arrives orders the same shortfall again.
 */
export function suggestedQuantity(
  onHand: Quantity,
  reorderLevel: Quantity,
  onOrder: Quantity,
  soldBy: SoldBy,
): number {
  if (onHand.milli + onOrder.milli > reorderLevel.milli) return 0;
  const target = reorderLevel.milli * 2;
  const short = Math.max(0, target - onHand.milli - onOrder.milli) / 1000;
  return soldBy === "unit" ? Math.ceil(short) : Math.round(short * 1000) / 1000;
}

/** Units still to arrive per product across a set of open orders. */
export function onOrderByProduct(progress: readonly OrderProgress[]): Map<string, Quantity> {
  const totals = new Map<string, Quantity>();
  for (const p of progress) {
    if (!isOpen(p.status)) continue;
    for (const line of p.lines) {
      const current = totals.get(line.productId)?.milli ?? 0;
      totals.set(line.productId, { milli: current + line.outstanding.milli });
    }
  }
  return totals;
}
