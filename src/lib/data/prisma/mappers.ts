import { kobo, type Money } from "@/lib/domain/money";
import { milli, type Quantity } from "@/lib/domain/quantity";
import type { Category, Product } from "@/types/catalog";
import type { StockEntry } from "@/types/stock";
import type { Sale, SaleLine, Shift, Tender } from "@/types/sale";
import type { Customer, StaffMember } from "@/types/people";
import type { Staff } from "@/types/staff";
import type { PaymentMethod, SaleStatus, SoldBy, StaffRole, StaffStatus, StockReason } from "@/types/enums";

/**
 * Database rows in, domain types out.
 *
 * The one place kobo becomes `Money` and milli-units become `Quantity`. Doing
 * it here rather than in each repository means there is exactly one file to
 * read to know that no naira float ever enters the application, and exactly one
 * to change if the storage representation ever moves.
 *
 * Every function is total and pure — no queries, no clock. A mapper that
 * fetches is a mapper that will N+1.
 */

/* ── Scalars ──────────────────────────────────────────────────────────────── */

/**
 * `Number()` on a kobo bigint is safe: 2^53 kobo is roughly ₦90 trillion. The
 * column is int8 to lift Postgres's int4 ceiling of ₦21,474,836.47, which a
 * branch passes in a good week — not because JavaScript needs the room.
 */
export const money = (value: bigint | number): Money =>
  kobo(typeof value === "bigint" ? Number(value) : value);

export const quantity = (value: number): Quantity => milli(value);

/** Timestamps cross as ISO instants in UTC; Lagos happens at render (SPEC §7). */
export const instant = (value: Date): string => value.toISOString();
export const maybeInstant = (value: Date | null): string | null =>
  value ? value.toISOString() : null;

/* ── Row shapes ───────────────────────────────────────────────────────────── */
//
// Declared structurally rather than imported from the generated client, so the
// mappers state exactly which columns they depend on. A `select` that stops
// fetching one of these becomes a type error here instead of an `undefined`
// three screens away.

export type CategoryRow = {
  id: string;
  name: string;
  position: number;
};

export type ProductRow = {
  id: string;
  sku: string;
  name: string;
  categoryId: string;
  priceKobo: bigint;
  costKobo: bigint;
  soldBy: SoldBy;
  unit: string;
  reorderLevelMilli: number;
  imageUrl: string | null;
  delistedAt: Date | null;
  category: { name: string } | null;
  barcodes?: { barcode: string }[];
};

export type StockLedgerRow = {
  id: string;
  branchId: string;
  productId: string;
  deltaMilli: number;
  reason: StockReason;
  at: Date;
  staffId: string | null;
  staffName: string;
  ref: string | null;
  note: string | null;
};

/* ── Catalog ──────────────────────────────────────────────────────────────── */

export const toCategory = (row: CategoryRow): Category => ({
  id: row.id,
  name: row.name,
  position: row.position,
});

export function toProduct(row: ProductRow): Product {
  return {
    id: row.id,
    sku: row.sku,
    barcodes: row.barcodes?.map((b) => b.barcode) ?? [],
    name: row.name,
    categoryId: row.categoryId,
    categoryName: row.category?.name ?? "",
    price: money(row.priceKobo),
    cost: money(row.costKobo),
    soldBy: row.soldBy,
    unit: row.unit,
    reorderLevel: quantity(row.reorderLevelMilli),
    imageUrl: row.imageUrl,
    delistedAt: maybeInstant(row.delistedAt),
  };
}

/* ── Stock ────────────────────────────────────────────────────────────────── */

export function toStockEntry(row: StockLedgerRow): StockEntry {
  return {
    id: row.id,
    branchId: row.branchId,
    productId: row.productId,
    delta: quantity(row.deltaMilli),
    reason: row.reason,
    at: instant(row.at),
    staffId: row.staffId ?? "",
    staffName: row.staffName,
    ...(row.ref ? { ref: row.ref } : {}),
    ...(row.note ? { note: row.note } : {}),
  };
}

/* ── Sales ────────────────────────────────────────────────────────────────── */

export type SaleRow = {
  id: string;
  receiptNo: string;
  branchId: string;
  branchName: string;
  staffId: string;
  staffName: string;
  staffCode: string;
  subtotalKobo: bigint;
  discountKobo: bigint;
  totalKobo: bigint;
  changeKobo: bigint;
  status: SaleStatus;
  at: Date;
  takenOffline: boolean;
  syncedAt: Date | null;
  customerId: string | null;
  customer: { fullName: string } | null;
  pointsEarned: number;
  pointsRedeemed: number;
  lines: {
    productId: string;
    name: string;
    sku: string;
    qtyMilli: number;
    soldBy: SoldBy;
    unit: string;
    unitPriceKobo: bigint;
    discountKobo: bigint;
    lineTotalKobo: bigint;
  }[];
  tenders: { method: PaymentMethod; amountKobo: bigint }[];
};

export function toSale(row: SaleRow): Sale {
  const lines: SaleLine[] = row.lines.map((line) => ({
    productId: line.productId,
    name: line.name,
    sku: line.sku,
    quantity: quantity(line.qtyMilli),
    soldBy: line.soldBy,
    unit: line.unit,
    unitPrice: money(line.unitPriceKobo),
    discount: money(line.discountKobo),
    lineTotal: money(line.lineTotalKobo),
  }));

  const tenders: Tender[] = row.tenders.map((t) => ({
    method: t.method,
    amount: money(t.amountKobo),
  }));

  return {
    id: row.id,
    receiptNo: row.receiptNo,
    branchId: row.branchId,
    branchName: row.branchName,
    staffId: row.staffId,
    staffName: row.staffName,
    staffCode: row.staffCode,
    customerId: row.customerId,
    customerName: row.customer?.fullName ?? null,
    pointsEarned: row.pointsEarned,
    pointsRedeemed: row.pointsRedeemed,
    lines,
    subtotal: money(row.subtotalKobo),
    discount: money(row.discountKobo),
    total: money(row.totalKobo),
    tenders,
    change: money(row.changeKobo),
    status: row.status,
    at: instant(row.at),
    takenOffline: row.takenOffline,
    syncedAt: maybeInstant(row.syncedAt),
  };
}

export type ShiftRowRaw = {
  id: string;
  branchId: string;
  staffId: string;
  tillLabel: string;
  openedAt: Date;
  openingFloatKobo: bigint;
  closedAt: Date | null;
  countedCashKobo: bigint | null;
  status: "open" | "closed" | "force_closed";
  staff: { fullName: string } | null;
};

export function toShift(row: ShiftRowRaw): Shift {
  return {
    id: row.id,
    branchId: row.branchId,
    staffId: row.staffId,
    staffName: row.staff?.fullName ?? "",
    tillLabel: row.tillLabel,
    openedAt: instant(row.openedAt),
    openingFloat: money(row.openingFloatKobo),
    closedAt: maybeInstant(row.closedAt),
    countedCash: row.countedCashKobo === null ? null : money(row.countedCashKobo),
    // The domain knows two states. A force-closed shift is a closed shift with
    // a story attached, and the story lives in the audit log, not here.
    status: row.status === "open" ? "open" : "closed",
  };
}

/* ── People ───────────────────────────────────────────────────────────────── */

export type StaffRowRaw = {
  id: string;
  orgId: string;
  branchId: string | null;
  role: StaffRole;
  fullName: string;
  email: string;
  staffCode: string;
  status: StaffStatus;
  phone: string | null;
  branch: { name: string } | null;
};

export const toStaff = (row: StaffRowRaw): Staff => ({
  id: row.id,
  orgId: row.orgId,
  branchId: row.branchId,
  branchName: row.branch?.name ?? null,
  role: row.role,
  fullName: row.fullName,
  email: row.email,
  staffCode: row.staffCode,
  status: row.status,
});

/**
 * The manager's roster row.
 *
 * Void rate and refund rate sit beside each other because an outlier on both is
 * the classic signature of till theft (SPEC §15.2). They are computed from
 * sales, not stored, so they cannot go stale — the caller supplies them.
 */
export function toStaffMember(
  row: StaffRowRaw,
  performance: {
    lastShiftAt: string | null;
    salesPerHour: Money;
    voidRatePercent: number;
    refundRatePercent: number;
  },
): StaffMember {
  return {
    id: row.id,
    fullName: row.fullName,
    staffCode: row.staffCode,
    role: row.role,
    branchId: row.branchId,
    status: row.status,
    phone: row.phone,
    email: row.email,
    ...performance,
  };
}

export type CustomerRowRaw = {
  id: string;
  fullName: string;
  phone: string;
  homeBranchId: string | null;
  enrolledAt: Date;
  lastVisitAt: Date | null;
};

export function toCustomer(
  row: CustomerRowRaw,
  totals: { visits: number; lifetimeSpend: Money; pointsBalance: number },
): Customer {
  return {
    id: row.id,
    fullName: row.fullName,
    phone: row.phone,
    homeBranchId: row.homeBranchId ?? "",
    enrolledAt: instant(row.enrolledAt),
    visits: totals.visits,
    lifetimeSpend: totals.lifetimeSpend,
    pointsBalance: totals.pointsBalance,
    lastVisitAt: maybeInstant(row.lastVisitAt),
  };
}
