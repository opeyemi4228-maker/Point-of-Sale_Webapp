import { ZERO, add, kobo, multiply, sum, type Money } from "./money";
import { ZERO_QTY, addQty, units, type Quantity } from "./quantity";
import { itemCount } from "./sale";
import type { StockEntry, StockSource } from "@/types/stock";
import type { Sale } from "@/types/sale";
import type { SoldBy, StockReason } from "@/types/enums";

/**
 * Inventory control — SPEC §7.7, §10.
 *
 * Everything a manager or HQ needs to *track* stock rather than just read a
 * balance: what came in and from whom, what went out and why, what is sitting
 * on the shelf past its date, and whether the books reconcile.
 *
 * Same rules as `stock.ts`. Nothing here edits a balance — the planners only
 * validate and return the movement to append, and every report is derived from
 * the ledger (CLAUDE.md rule 3). Pure: no I/O, no clock, no React. "Today" and
 * date ranges are always parameters.
 */

/* ── Days ─────────────────────────────────────────────────────────────────── */

/** An inclusive-from, exclusive-to window of ISO instants. */
export type InstantRange = { from: string; to: string };

const DAY_MS = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD` that is a real calendar day. `2026-02-30` is not. */
export function isIsoDay(value: string): boolean {
  if (!ISO_DAY.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

const dayNumber = (day: string): number => {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
};

/** Whole calendar days from `a` to `b`. Negative when `b` is earlier. */
export const daysBetween = (a: string, b: string): number => dayNumber(b) - dayNumber(a);

/** The calendar day `n` days after `day`. */
export function shiftDay(day: string, n: number): string {
  return new Date((dayNumber(day) + n) * DAY_MS).toISOString().slice(0, 10);
}

/** Every day from `from` to `to`, both included. */
export function daysIn(from: string, to: string): string[] {
  const count = daysBetween(from, to);
  return Array.from({ length: Math.max(0, count + 1) }, (_, i) => shiftDay(from, i));
}

const within = (at: string, range: InstantRange) => {
  const t = Date.parse(at);
  return t >= Date.parse(range.from) && t < Date.parse(range.to);
};

/* ── Reconciliation ───────────────────────────────────────────────────────── */

/**
 * The columns of a stock reconciliation. Every reason maps to exactly one, and
 * the map is a `Record` so a new reason in the enum fails the build here until
 * somebody decides where it belongs — a reason that silently fell out of the
 * report would make the columns stop adding up.
 */
export type ReconColumn = "received" | "transfers" | "sold" | "expired" | "losses" | "adjusted";

export const RECON_COLUMN: Record<StockReason, ReconColumn> = {
  BRANCH_OPENED: "received",
  PURCHASE_RECEIPT: "received",
  TRANSFER_IN: "transfers",
  TRANSFER_OUT: "transfers",
  SALE: "sold",
  REFUND: "sold",
  VOID: "sold",
  ONLINE_ORDER: "sold",
  ONLINE_RETURN: "sold",
  EXPIRY: "expired",
  DAMAGE: "losses",
  THEFT: "losses",
  SAMPLE: "losses",
  COUNT_ADJUSTMENT: "adjusted",
  CORRECTION: "adjusted",
};

export type ReconRow = { opening: Quantity; closing: Quantity } & Record<ReconColumn, Quantity>;

const emptyRow = (): ReconRow => ({
  opening: ZERO_QTY,
  received: ZERO_QTY,
  transfers: ZERO_QTY,
  sold: ZERO_QTY,
  expired: ZERO_QTY,
  losses: ZERO_QTY,
  adjusted: ZERO_QTY,
  closing: ZERO_QTY,
});

/**
 * Opening + every movement in the window = closing, per product.
 *
 * All columns are signed, so the row proves itself: a reader can add it up
 * across and land on the closing figure. Movements after the window are
 * ignored, so a report for last week does not shift when today's sales land.
 */
export function reconcile(
  entries: readonly StockEntry[],
  range: InstantRange,
): Map<string, ReconRow> {
  const rows = new Map<string, ReconRow>();
  const fromMs = Date.parse(range.from);
  const toMs = Date.parse(range.to);

  for (const entry of entries) {
    const t = Date.parse(entry.at);
    if (t >= toMs) continue;

    let row = rows.get(entry.productId);
    if (!row) {
      row = emptyRow();
      rows.set(entry.productId, row);
    }

    if (t < fromMs) {
      row.opening = addQty(row.opening, entry.delta);
    } else {
      const column = RECON_COLUMN[entry.reason];
      row[column] = addQty(row[column], entry.delta);
    }
    row.closing = addQty(row.closing, entry.delta);
  }

  return rows;
}

/* ── Deliveries (purchases) ───────────────────────────────────────────────── */

export type DeliveryLine = {
  entryId: string;
  productId: string;
  quantity: Quantity;
  unitCost: Money;
  value: Money;
  expiresOn: string | null;
};

export type Delivery = {
  /** The goods-received reference that ties the lines together. */
  ref: string;
  branchId: string;
  at: string;
  staffName: string;
  source: StockSource | null;
  /** The purchase order it was delivered against, if any. */
  orderRef: string | null;
  lines: DeliveryLine[];
  /** Sum of the rounded line values — never recomputed from raw inputs. */
  value: Money;
};

/**
 * Receipts grouped back into the deliveries they arrived on, newest first.
 *
 * `costOf` is the catalog fallback for rows that did not record what was paid.
 * It is a parameter, not an import, for the reason `stockValue` gives: cost
 * prices are handed over deliberately, never reached for.
 */
export function deliveriesFrom(
  entries: readonly StockEntry[],
  costOf: (productId: string) => Money,
): Delivery[] {
  const groups = new Map<string, Delivery>();

  for (const entry of entries) {
    if (entry.reason !== "PURCHASE_RECEIPT") continue;

    const ref = entry.ref ?? entry.id;
    const key = `${entry.branchId}|${ref}`;
    const unitCost = entry.unitCost ?? costOf(entry.productId);
    const line: DeliveryLine = {
      entryId: entry.id,
      productId: entry.productId,
      quantity: entry.delta,
      unitCost,
      value: multiply(unitCost, entry.delta.milli / 1000),
      expiresOn: entry.expiresOn ?? null,
    };

    const existing = groups.get(key);
    if (existing) {
      existing.lines.push(line);
      if (entry.at < existing.at) existing.at = entry.at;
      if (!existing.source && entry.source) existing.source = entry.source;
    } else {
      groups.set(key, {
        ref,
        branchId: entry.branchId,
        at: entry.at,
        staffName: entry.staffName,
        source: entry.source ?? null,
        orderRef: entry.orderRef ?? null,
        lines: [line],
        value: ZERO,
      });
    }
  }

  return [...groups.values()]
    .map((delivery) => ({ ...delivery, value: sum(delivery.lines.map((l) => l.value)) }))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/** Deliveries landed inside a window. */
export const deliveriesWithin = (deliveries: readonly Delivery[], range: InstantRange) =>
  deliveries.filter((d) => within(d.at, range));

export type DeliveryDraftLine = {
  productId: string;
  productName: string;
  soldBy: SoldBy;
  /** As keyed — a plain number, validated here. */
  quantity: number;
  unitCost: Money;
  /** `YYYY-MM-DD`, or empty when the line does not date (detergent, soap). */
  expiresOn: string;
};

export type DeliveryDraft = {
  source: { kind: StockSource["kind"]; name: string; document: string };
  lines: readonly DeliveryDraftLine[];
  /** The Lagos day it is being received on. */
  receivedOn: string;
};

export type DraftProblem = {
  field: "source" | "lines" | "quantity" | "unitCost" | "expiresOn";
  /** Which line, for line-level problems. */
  line?: number;
  message: string;
};

export type PlannedDeliveryLine = {
  productId: string;
  quantity: Quantity;
  unitCost: Money;
  expiresOn?: string;
};

/**
 * Check a delivery before it touches the ledger.
 *
 * Every problem is returned at once, not the first one, so a manager with a
 * ten-line delivery fixes it in one pass rather than discovering the problems
 * one press of "Receive" at a time.
 */
export function planDelivery(
  draft: DeliveryDraft,
):
  | { ok: true; source: StockSource; lines: PlannedDeliveryLine[] }
  | { ok: false; problems: DraftProblem[] } {
  const problems: DraftProblem[] = [];
  const name = draft.source.name.trim();

  if (!name) {
    problems.push({
      field: "source",
      message:
        draft.source.kind === "warehouse"
          ? "Say which warehouse this came from."
          : "Say which supplier this came from.",
    });
  }
  if (draft.lines.length === 0) {
    problems.push({ field: "lines", message: "Add at least one product to the delivery." });
  }

  const lines: PlannedDeliveryLine[] = [];
  draft.lines.forEach((line, index) => {
    const qtyProblem = quantityProblem(line.quantity, line.soldBy);
    if (qtyProblem) {
      problems.push({ field: "quantity", line: index, message: `${line.productName}: ${qtyProblem}` });
    }
    if (line.unitCost.kobo < 0) {
      problems.push({
        field: "unitCost",
        line: index,
        message: `${line.productName}: enter a unit cost of zero or more.`,
      });
    }

    const expiresOn = line.expiresOn.trim();
    if (expiresOn) {
      if (!isIsoDay(expiresOn)) {
        problems.push({
          field: "expiresOn",
          line: index,
          message: `${line.productName}: that is not a real date.`,
        });
      } else if (daysBetween(draft.receivedOn, expiresOn) <= 0) {
        problems.push({
          field: "expiresOn",
          line: index,
          message: `${line.productName}: already at or past its expiry date. Refuse it at the door rather than receiving it into stock.`,
        });
      }
    }

    if (!qtyProblem) {
      lines.push({
        productId: line.productId,
        quantity: units(line.quantity),
        unitCost: line.unitCost,
        ...(expiresOn && isIsoDay(expiresOn) ? { expiresOn } : {}),
      });
    }
  });

  if (problems.length > 0) return { ok: false, problems };

  const document = draft.source.document.trim();
  return {
    ok: true,
    source: { kind: draft.source.kind, name, ...(document ? { document } : {}) },
    lines,
  };
}

/* ── Adjustments ──────────────────────────────────────────────────────────── */

export type AdjustDirection = "add" | "remove";

export type AdjustReasonOption = {
  reason: StockReason;
  label: string;
  /** Shown under the choice, so the right one gets picked. */
  hint: string;
  /** Reasons that need a sentence of explanation to be auditable. */
  needsNote: boolean;
};

/**
 * What a manager may record by hand, by direction.
 *
 * Deliberately not every reason. `SALE`, `TRANSFER_*` and `PURCHASE_RECEIPT`
 * are written by their own flows, with their own documents; letting them be
 * keyed here would produce a "sale" with no receipt behind it.
 */
export const ADJUST_REASONS: Record<AdjustDirection, readonly AdjustReasonOption[]> = {
  add: [
    {
      reason: "COUNT_ADJUSTMENT",
      label: "Count surplus",
      hint: "The shelf holds more than the system says.",
      needsNote: false,
    },
    {
      reason: "CORRECTION",
      label: "Correction",
      hint: "Undo a mistake — say what the mistake was.",
      needsNote: true,
    },
  ],
  remove: [
    {
      reason: "EXPIRY",
      label: "Expired",
      hint: "Past its date. Recorded in the protected write-off register.",
      needsNote: false,
    },
    {
      reason: "DAMAGE",
      label: "Damaged",
      hint: "Broken, crushed, leaking or spoiled.",
      needsNote: false,
    },
    {
      reason: "THEFT",
      label: "Theft or missing",
      hint: "Gone without a sale. Say what is known.",
      needsNote: true,
    },
    {
      reason: "SAMPLE",
      label: "Sample or tasting",
      hint: "Opened for customers to try.",
      needsNote: false,
    },
    {
      reason: "COUNT_ADJUSTMENT",
      label: "Count shortfall",
      hint: "The shelf holds less than the system says.",
      needsNote: false,
    },
    {
      reason: "CORRECTION",
      label: "Correction",
      hint: "Undo a mistake — say what the mistake was.",
      needsNote: true,
    },
  ],
};

export type AdjustmentInput = {
  direction: AdjustDirection;
  reason: StockReason;
  /** As keyed. */
  quantity: number;
  soldBy: SoldBy;
  onHand: Quantity;
  note: string;
};

export type AdjustmentProblem = { field: "reason" | "quantity" | "note"; message: string };

/**
 * Validate a hand-keyed movement and return the signed delta to append.
 *
 * Removal is capped at what the ledger says is on hand. Writing off ten when
 * the system holds six would manufacture a negative balance that looks exactly
 * like an offline oversell — and that exception must keep meaning one thing.
 * If the shelf disagrees with the ledger, the fix is a count, not a bigger
 * write-off.
 */
export function planAdjustment(
  input: AdjustmentInput,
): { ok: true; delta: Quantity } | { ok: false; problems: AdjustmentProblem[] } {
  const problems: AdjustmentProblem[] = [];
  const option = ADJUST_REASONS[input.direction].find((o) => o.reason === input.reason);

  if (!option) {
    problems.push({ field: "reason", message: "Pick a reason from the list." });
  }

  const qtyProblem = quantityProblem(input.quantity, input.soldBy);
  if (qtyProblem) {
    problems.push({ field: "quantity", message: qtyProblem });
  } else if (input.direction === "remove") {
    const asked = units(input.quantity);
    if (input.onHand.milli <= 0) {
      problems.push({
        field: "quantity",
        message: "Nothing is on hand to remove. Count the shelf first if that looks wrong.",
      });
    } else if (asked.milli > input.onHand.milli) {
      problems.push({
        field: "quantity",
        message: `Only ${input.onHand.milli / 1000} on hand. Count the shelf first if the figure is wrong.`,
      });
    }
  }

  if (option?.needsNote && input.note.trim().length < 3) {
    problems.push({ field: "note", message: "Add a short note — this reason needs one." });
  }

  if (problems.length > 0) return { ok: false, problems };

  const magnitude = units(input.quantity);
  return {
    ok: true,
    delta: input.direction === "add" ? magnitude : { milli: -magnitude.milli },
  };
}

function quantityProblem(quantity: number, soldBy: SoldBy): string | null {
  if (!Number.isFinite(quantity) || quantity <= 0) return "enter a quantity above zero.";
  if (soldBy === "unit" && !Number.isInteger(quantity)) {
    return "this line is counted in whole units.";
  }
  // Tolerance, not equality: 1.005 * 1000 is 1004.9999999999999 in a float.
  const thousandths = quantity * 1000;
  if (Math.abs(thousandths - Math.round(thousandths)) > 1e-6) {
    return "weights go to three decimal places at most.";
  }
  return null;
}

/* ── Expiry ───────────────────────────────────────────────────────────────── */

export type BatchStatus = "expired" | "soon" | "fresh";

export type Batch = {
  entryId: string;
  branchId: string;
  productId: string;
  ref: string | null;
  source: StockSource | null;
  receivedAt: string;
  expiresOn: string;
  received: Quantity;
  /** Estimated still on the shelf — see `batchesOnHand`. */
  remaining: Quantity;
  /** Zero on the expiry day, negative after it. */
  daysLeft: number;
  status: BatchStatus;
};

/** Movements that put a batch on the shelf. */
const INBOUND_BATCH: ReadonlySet<StockReason> = new Set([
  "BRANCH_OPENED",
  "PURCHASE_RECEIPT",
  "TRANSFER_IN",
]);

/**
 * Dated batches still on the shelf, soonest expiry first.
 *
 * The ledger knows how much of a product is on hand but not which delivery it
 * came from, so this estimates it the way a shop actually rotates stock: first
 * in, first out. What is on hand is assumed to be the most recent deliveries,
 * and anything older has sold through. Writing off an expired batch lowers
 * on-hand, so the old batch drains to zero and drops off the list by itself —
 * no second record of "what is left in batch 3" that could disagree with the
 * ledger.
 *
 * It is an estimate and the screen says so; the manager confirms the real
 * number from the shelf before writing anything off.
 *
 * "Expired" includes the expiry day itself: a product cannot be sold on the
 * day it expires.
 */
export function batchesOnHand(
  entries: readonly StockEntry[],
  options: { today: string; soonDays: number },
): Batch[] {
  const byLine = new Map<string, StockEntry[]>();
  for (const entry of entries) {
    const key = `${entry.branchId}|${entry.productId}`;
    const list = byLine.get(key);
    if (list) list.push(entry);
    else byLine.set(key, [entry]);
  }

  const batches: Batch[] = [];

  for (const lineEntries of byLine.values()) {
    if (!lineEntries.some((e) => e.expiresOn)) continue;

    // An expiry write-off that names its batch (by best-before) comes off
    // *that* batch, not off whatever first-in-first-out would guess — otherwise
    // older undated stock absorbs the removal and the expired batch never
    // drains. Such write-offs, and any corrections reversing them, are taken
    // out of the shared balance and charged to their batch directly.
    const tagged = new Map<string, StockEntry>();
    for (const e of lineEntries) if (e.reason === "EXPIRY" && e.expiresOn) tagged.set(e.id, e);
    const reversedTagged = new Set<string>();
    for (const e of lineEntries) {
      if (e.reason === "CORRECTION" && e.delta.milli > 0 && e.ref && tagged.has(e.ref)) reversedTagged.add(e.ref);
    }
    const pulled = new Map<string, number>();
    for (const [id, e] of tagged) {
      if (reversedTagged.has(id)) continue;
      pulled.set(e.expiresOn!, (pulled.get(e.expiresOn!) ?? 0) - e.delta.milli);
    }

    let left = lineEntries.reduce((total, e) => {
      if (tagged.has(e.id)) return total;
      if (e.reason === "CORRECTION" && e.ref && tagged.has(e.ref)) return total;
      return total + e.delta.milli;
    }, 0);
    if (left <= 0) continue;

    const inbound = lineEntries
      .filter((e) => INBOUND_BATCH.has(e.reason) && e.delta.milli > 0)
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

    for (const entry of inbound) {
      if (left <= 0) break;
      let take = Math.min(entry.delta.milli, left);
      left -= take;
      if (!entry.expiresOn) continue;

      // Charge tagged write-offs against this batch, once.
      const already = pulled.get(entry.expiresOn) ?? 0;
      if (already > 0) {
        const used = Math.min(already, take);
        take -= used;
        pulled.set(entry.expiresOn, already - used);
      }
      if (take <= 0) continue;

      const daysLeft = daysBetween(options.today, entry.expiresOn);
      batches.push({
        entryId: entry.id,
        branchId: entry.branchId,
        productId: entry.productId,
        ref: entry.ref ?? null,
        source: entry.source ?? null,
        receivedAt: entry.at,
        expiresOn: entry.expiresOn,
        received: entry.delta,
        remaining: { milli: take },
        daysLeft,
        status: daysLeft <= 0 ? "expired" : daysLeft <= options.soonDays ? "soon" : "fresh",
      });
    }
  }

  return batches.sort(
    (a, b) => a.daysLeft - b.daysLeft || a.productId.localeCompare(b.productId),
  );
}

/* ── Write-off register ───────────────────────────────────────────────────── */

/** Removals that are losses rather than trade. */
export const WRITE_OFF_REASONS: readonly StockReason[] = ["EXPIRY", "DAMAGE", "THEFT", "SAMPLE"];

export type WriteOff = {
  entry: StockEntry;
  /** The reversing correction, when one was recorded. The original stays. */
  reversedBy: StockEntry | null;
  value: Money;
};

/**
 * Every write-off, newest first, each with whatever reversed it.
 *
 * The register is protected: a write-off is never edited or removed, only
 * reversed by a `CORRECTION` whose `ref` is the write-off's id. Both stay on
 * the record, so the register shows what was claimed and what was undone.
 */
export function writeOffRegister(
  entries: readonly StockEntry[],
  costOf: (productId: string) => Money,
  reasons: readonly StockReason[] = WRITE_OFF_REASONS,
): WriteOff[] {
  const reversals = new Map<string, StockEntry>();
  for (const entry of entries) {
    if (entry.reason === "CORRECTION" && entry.delta.milli > 0 && entry.ref) {
      reversals.set(entry.ref, entry);
    }
  }

  return entries
    .filter((entry) => reasons.includes(entry.reason) && entry.delta.milli < 0)
    .map((entry) => ({
      entry,
      reversedBy: reversals.get(entry.id) ?? null,
      value: multiply(costOf(entry.productId), -entry.delta.milli / 1000),
    }))
    .sort((a, b) => Date.parse(b.entry.at) - Date.parse(a.entry.at));
}

/* ── Sales ────────────────────────────────────────────────────────────────── */

export type SalesSummary = {
  revenue: Money;
  transactions: number;
  averageBasket: Money;
  items: number;
  byDay: { day: string; revenue: Money; transactions: number }[];
  byProduct: { productId: string; name: string; unit: string; quantity: Quantity; revenue: Money }[];
};

/** Sales that count as trade. A voided or fully refunded sale did not happen. */
const COUNTS_AS_TRADE = new Set<Sale["status"]>(["completed", "partially_refunded"]);

/**
 * Takings for a window, by day and by product.
 *
 * `dayOf` turns an instant into the Lagos calendar day — a parameter because
 * this module never touches time zones. `days` fills the chart so a day with
 * no sales shows as zero rather than vanishing from the axis.
 */
export function summariseSales(
  sales: readonly Sale[],
  range: InstantRange,
  dayOf: (iso: string) => string,
  days: readonly string[] = [],
): SalesSummary {
  const traded = sales.filter((s) => COUNTS_AS_TRADE.has(s.status) && within(s.at, range));

  const byDay = new Map<string, { revenue: Money; transactions: number }>(
    days.map((day) => [day, { revenue: ZERO, transactions: 0 }]),
  );
  const byProduct = new Map<string, SalesSummary["byProduct"][number]>();
  let items = 0;

  for (const sale of traded) {
    const day = dayOf(sale.at);
    const bucket = byDay.get(day) ?? { revenue: ZERO, transactions: 0 };
    byDay.set(day, {
      revenue: add(bucket.revenue, sale.total),
      transactions: bucket.transactions + 1,
    });
    items += itemCount(sale.lines);

    for (const line of sale.lines) {
      const current = byProduct.get(line.productId);
      byProduct.set(line.productId, {
        productId: line.productId,
        name: line.name,
        unit: line.unit,
        quantity: addQty(current?.quantity ?? ZERO_QTY, line.quantity),
        revenue: add(current?.revenue ?? ZERO, line.lineTotal),
      });
    }
  }

  const revenue = sum(traded.map((s) => s.total));

  return {
    revenue,
    transactions: traded.length,
    averageBasket: traded.length ? kobo(Math.round(revenue.kobo / traded.length)) : ZERO,
    items,
    byDay: [...byDay.entries()]
      .map(([day, v]) => ({ day, ...v }))
      .sort((a, b) => a.day.localeCompare(b.day)),
    byProduct: [...byProduct.values()].sort((a, b) => b.revenue.kobo - a.revenue.kobo),
  };
}

/* ── Product activity: quantity and value, side by side ───────────────────── */

const SALE_REASONS: ReadonlySet<StockReason> = new Set([
  "SALE",
  "ONLINE_ORDER",
  "REFUND",
  "VOID",
  "ONLINE_RETURN",
]);
const WASTE_REASONS: ReadonlySet<StockReason> = new Set(["EXPIRY", "DAMAGE", "THEFT", "SAMPLE"]);
const ADJUST_REASONS_SET: ReadonlySet<StockReason> = new Set([
  "COUNT_ADJUSTMENT",
  "CORRECTION",
  "BRANCH_OPENED",
]);

export type Pricing = {
  costOf: (productId: string) => Money;
  /** Shelf price, for sale movements with no receipt to read the real price from. */
  priceOf: (productId: string) => Money;
};

/**
 * What each sale-side movement took at the till, in naira.
 *
 * A till sale's movements carry the receipt number as `ref`, so the real line
 * totals — discounts and overrides included — are read off the receipt. A
 * movement with no receipt this device holds (synced from elsewhere, or
 * opening fixtures) is valued at shelf price and flagged as an estimate,
 * because a report that quietly mixes actual and estimated takings is worse
 * than one that says which is which.
 */
export function pricedTrade(
  entries: readonly StockEntry[],
  sales: readonly Sale[],
  priceOf: (productId: string) => Money,
): Map<string, { value: Money; estimated: boolean }> {
  const actual = new Map<string, Money>();
  for (const sale of sales) {
    if (!COUNTS_AS_TRADE.has(sale.status)) continue;
    for (const line of sale.lines) {
      const key = `${sale.receiptNo}|${line.productId}`;
      actual.set(key, add(actual.get(key) ?? ZERO, line.lineTotal));
    }
  }

  const used = new Set<string>();
  const priced = new Map<string, { value: Money; estimated: boolean }>();
  for (const entry of entries) {
    if (!SALE_REASONS.has(entry.reason)) continue;
    const key = entry.ref ? `${entry.ref}|${entry.productId}` : null;
    // A receipt with two lines of the same product produces two movements;
    // the receipt's total for that product is booked once, on the first.
    if (key && actual.has(key) && entry.delta.milli < 0) {
      priced.set(entry.id, { value: used.has(key) ? ZERO : actual.get(key)!, estimated: false });
      used.add(key);
      continue;
    }
    priced.set(entry.id, {
      value: multiply(priceOf(entry.productId), -entry.delta.milli / 1000),
      estimated: true,
    });
  }
  return priced;
}

export type ActivityRow = {
  productId: string;
  opening: Quantity;
  openingValue: Money;
  purchased: Quantity;
  purchasedValue: Money;
  /** Units out to customers, net of returns. Positive. */
  sold: Quantity;
  salesValue: Money;
  /** The part of `salesValue` valued at shelf price, not off a receipt. */
  estimatedSales: Money;
  costOfSales: Money;
  grossProfit: Money;
  /** Units written off — expired, damaged, stolen, sampled. Positive. */
  wasted: Quantity;
  wastedValue: Money;
  expired: Quantity;
  /** Net of transfers in and out. Signed. */
  transfers: Quantity;
  /** Count adjustments, corrections, opening stock. Signed. */
  adjusted: Quantity;
  closing: Quantity;
  closingValue: Money;
};

/**
 * One row per product: opening + purchased − sold − wasted ± transfers ±
 * adjusted = closing, in units, with each column also valued.
 *
 * Stock values are at catalog cost; purchases at the cost actually paid;
 * sales at what the customer paid. Gross profit is sales less the catalog
 * cost of the units sold.
 */
export function productActivity(
  entries: readonly StockEntry[],
  sales: readonly Sale[],
  range: InstantRange,
  pricing: Pricing,
): Map<string, ActivityRow> {
  const fromMs = Date.parse(range.from);
  const toMs = Date.parse(range.to);
  const priced = pricedTrade(
    entries.filter((e) => {
      const t = Date.parse(e.at);
      return t >= fromMs && t < toMs;
    }),
    sales,
    pricing.priceOf,
  );

  type Acc = {
    opening: number;
    purchased: number;
    purchasedValue: number;
    sold: number;
    salesValue: number;
    estimated: number;
    wasted: number;
    expired: number;
    transfers: number;
    adjusted: number;
  };
  const acc = new Map<string, Acc>();

  // A write-off reversed by a correction (its `ref` is the write-off's id) was
  // never a loss. Net the reversal against waste, not into adjustments, so
  // this report agrees with the write-off register.
  const writeOffReason = new Map<string, StockReason>();
  for (const e of entries) if (WASTE_REASONS.has(e.reason)) writeOffReason.set(e.id, e.reason);

  for (const entry of entries) {
    const t = Date.parse(entry.at);
    if (t >= toMs) continue;
    let a = acc.get(entry.productId);
    if (!a) {
      a = { opening: 0, purchased: 0, purchasedValue: 0, sold: 0, salesValue: 0, estimated: 0, wasted: 0, expired: 0, transfers: 0, adjusted: 0 };
      acc.set(entry.productId, a);
    }
    const m = entry.delta.milli;
    if (t < fromMs) {
      a.opening += m;
      continue;
    }
    if (entry.reason === "PURCHASE_RECEIPT") {
      a.purchased += m;
      a.purchasedValue += multiply(entry.unitCost ?? pricing.costOf(entry.productId), m / 1000).kobo;
    } else if (SALE_REASONS.has(entry.reason)) {
      a.sold -= m;
      const p = priced.get(entry.id);
      if (p) {
        a.salesValue += p.value.kobo;
        if (p.estimated) a.estimated += p.value.kobo;
      }
    } else if (WASTE_REASONS.has(entry.reason)) {
      a.wasted -= m;
      if (entry.reason === "EXPIRY") a.expired -= m;
    } else if (entry.reason === "TRANSFER_IN" || entry.reason === "TRANSFER_OUT") {
      a.transfers += m;
    } else if (entry.reason === "CORRECTION" && entry.ref && writeOffReason.has(entry.ref)) {
      a.wasted -= m;
      if (writeOffReason.get(entry.ref) === "EXPIRY") a.expired -= m;
    } else if (ADJUST_REASONS_SET.has(entry.reason)) {
      a.adjusted += m;
    }
  }

  const rows = new Map<string, ActivityRow>();
  for (const [productId, a] of acc) {
    const cost = pricing.costOf(productId);
    const closing = a.opening + a.purchased - a.sold - a.wasted + a.transfers + a.adjusted;
    const costOfSales = multiply(cost, a.sold / 1000);
    rows.set(productId, {
      productId,
      opening: { milli: a.opening },
      openingValue: multiply(cost, a.opening / 1000),
      purchased: { milli: a.purchased },
      purchasedValue: { kobo: a.purchasedValue },
      sold: { milli: a.sold },
      salesValue: { kobo: a.salesValue },
      estimatedSales: { kobo: a.estimated },
      costOfSales,
      grossProfit: { kobo: a.salesValue - costOfSales.kobo },
      wasted: { milli: a.wasted },
      wastedValue: multiply(cost, a.wasted / 1000),
      expired: { milli: a.expired },
      transfers: { milli: a.transfers },
      adjusted: { milli: a.adjusted },
      closing: { milli: closing },
      closingValue: multiply(cost, closing / 1000),
    });
  }
  return rows;
}

/** True when anything happened to the line inside the window. */
export const activityMoved = (row: ActivityRow) =>
  row.purchased.milli !== 0 ||
  row.sold.milli !== 0 ||
  row.wasted.milli !== 0 ||
  row.transfers.milli !== 0 ||
  row.adjusted.milli !== 0;

export type DailyTrade = {
  day: string;
  salesValue: Money;
  purchasesValue: Money;
  transactions: number;
  /** Distinct deliveries received that day. */
  deliveries: number;
};

/**
 * Sales and purchases per Lagos day, from the ledger — so the chart and the
 * product table are built from the same rows and always add up to each other.
 * `transactions` counts receipts, which only the till's own sales carry.
 */
export function dailyTrade(
  entries: readonly StockEntry[],
  sales: readonly Sale[],
  range: InstantRange,
  dayOf: (iso: string) => string,
  days: readonly string[],
  pricing: Pricing,
  include: (productId: string) => boolean = () => true,
): DailyTrade[] {
  const inWindow = entries.filter((e) => within(e.at, range) && include(e.productId));
  const priced = pricedTrade(inWindow, sales, pricing.priceOf);
  const byDay = new Map<string, { s: number; p: number; receipts: Set<string>; grns: Set<string> }>(
    days.map((d) => [d, { s: 0, p: 0, receipts: new Set<string>(), grns: new Set<string>() }]),
  );

  for (const entry of inWindow) {
    const day = dayOf(entry.at);
    const bucket = byDay.get(day);
    if (!bucket) continue;
    if (entry.reason === "PURCHASE_RECEIPT") {
      bucket.p += multiply(entry.unitCost ?? pricing.costOf(entry.productId), entry.delta.milli / 1000).kobo;
      bucket.grns.add(entry.ref ?? entry.id);
    } else if (SALE_REASONS.has(entry.reason)) {
      bucket.s += priced.get(entry.id)?.value.kobo ?? 0;
      if (entry.ref && entry.reason === "SALE") bucket.receipts.add(entry.ref);
    }
  }

  return [...byDay.entries()]
    .map(([day, b]) => ({
      day,
      salesValue: { kobo: b.s },
      purchasesValue: { kobo: b.p },
      transactions: b.receipts.size,
      deliveries: b.grns.size,
    }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

/* ── Stock as at a moment ─────────────────────────────────────────────────── */

/**
 * On-hand for every product in a branch as it stood at `asAt` — every movement
 * strictly before that instant, nothing after.
 *
 * How the stock screen answers "what did we hold at close of business on the
 * 31st". Because balances are only ever sums of the ledger (rule 3), a past
 * balance is the same sum cut earlier — there is no snapshot to keep and none
 * that could drift. Pass the *end* of a Lagos day (`lagosDayRange(d, d).to`)
 * for "at close of that day".
 */
export function balancesAsAt(
  entries: readonly StockEntry[],
  branchId: string,
  asAt: string,
): Map<string, { onHand: Quantity; lastMovedAt: string | null }> {
  const cut = Date.parse(asAt);
  const out = new Map<string, { onHand: Quantity; lastMovedAt: string | null }>();
  for (const e of entries) {
    if (e.branchId !== branchId || Date.parse(e.at) >= cut) continue;
    const cur = out.get(e.productId);
    if (!cur) {
      out.set(e.productId, { onHand: e.delta, lastMovedAt: e.at });
    } else {
      cur.onHand = addQty(cur.onHand, e.delta);
      if (!cur.lastMovedAt || Date.parse(e.at) > Date.parse(cur.lastMovedAt)) cur.lastMovedAt = e.at;
    }
  }
  return out;
}
