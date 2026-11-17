import type { Actor } from "@/lib/db";
import { dbFor } from "@/lib/db";
import { money, quantity, toCategory, toProduct, toSale, toStockEntry } from "./mappers";
import type {
  BranchRepository,
  BranchSummary,
  CatalogRepository,
  PurchasingRepository,
  SalesRepository,
  StockRepository,
} from "../repositories";
import type { StockEntry } from "@/types/stock";
import type { Sale } from "@/types/sale";
import type { PurchaseOrder } from "@/types/operations";

/**
 * Prisma-backed repositories.
 *
 * Every method opens a transaction through `dbFor(actor)`, which sets the
 * `app.*` session variables the row-level security policies read. Nothing here
 * filters by branch by hand — the database does it, and a query that somehow
 * escaped this file would return nothing rather than everything
 * (docs/DATABASE.md §3).
 *
 * Cost prices are selected only where a manager or HQ screen genuinely needs
 * them for margin. Row security cannot hide a column, so the omission is the
 * control.
 */

/* ── The Lagos day ────────────────────────────────────────────────────────── */
//
// Reports are cut on Lagos days, and Lagos is UTC+1 with no daylight saving —
// which is the one thing that makes this arithmetic safe to do by hand. A day
// runs from 23:00 UTC the previous evening.

const LAGOS_OFFSET_HOURS = 1;

export function lagosDayBounds(day: string): { from: Date; to: Date } {
  const [y, m, d] = day.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 1, d, -LAGOS_OFFSET_HOURS, 0, 0, 0));
  const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
  return { from, to };
}

/* ── Branches ─────────────────────────────────────────────────────────────── */

export function branchRepository(actor: Actor): BranchRepository {
  const db = dbFor(actor);
  return {
    async list(): Promise<BranchSummary[]> {
      return db(async (tx) => {
        const rows = await tx.branch.findMany({
          where: { deletedAt: null },
          orderBy: [{ position: "asc" }, { name: "asc" }],
          select: { id: true, name: true, code: true, city: true, position: true },
        });
        return rows;
      });
    },
  };
}

/* ── Catalog ──────────────────────────────────────────────────────────────── */

const PRODUCT_SELECT = {
  id: true,
  sku: true,
  name: true,
  categoryId: true,
  priceKobo: true,
  costKobo: true,
  soldBy: true,
  unit: true,
  reorderLevelMilli: true,
  imageUrl: true,
  delistedAt: true,
  category: { select: { name: true } },
  barcodes: { select: { barcode: true } },
} as const;

export function catalogRepository(actor: Actor): CatalogRepository {
  const db = dbFor(actor);
  return {
    async listProducts() {
      return db(async (tx) => {
        const rows = await tx.product.findMany({
          where: { delistedAt: null },
          orderBy: { name: "asc" },
          select: PRODUCT_SELECT,
        });
        return rows.map(toProduct);
      });
    },

    async listCategories() {
      return db(async (tx) => {
        const rows = await tx.category.findMany({
          where: { deletedAt: null },
          orderBy: [{ position: "asc" }, { name: "asc" }],
          select: { id: true, name: true, position: true },
        });
        return rows.map(toCategory);
      });
    },

    async findByBarcode(barcode: string) {
      return db(async (tx) => {
        const hit = await tx.productBarcode.findUnique({
          where: { barcode },
          select: { product: { select: PRODUCT_SELECT } },
        });
        return hit?.product ? toProduct(hit.product) : null;
      });
    },
  };
}

/* ── Stock ────────────────────────────────────────────────────────────────── */

const LEDGER_SELECT = {
  id: true,
  branchId: true,
  productId: true,
  deltaMilli: true,
  reason: true,
  at: true,
  staffId: true,
  staffName: true,
  ref: true,
  note: true,
} as const;

export function stockRepository(actor: Actor): StockRepository {
  const db = dbFor(actor);
  return {
    async listEntries(branchId?: string) {
      return db(async (tx) => {
        const rows = await tx.stockLedger.findMany({
          ...(branchId ? { where: { branchId } } : {}),
          orderBy: { at: "desc" },
          select: LEDGER_SELECT,
        });
        return rows.map(toStockEntry);
      });
    },

    async append(entries: readonly Omit<StockEntry, "id">[]) {
      return db(async (tx) => {
        const created = [];
        for (const entry of entries) {
          const row = await tx.stockLedger.create({
            data: {
              branchId: entry.branchId,
              productId: entry.productId,
              deltaMilli: entry.delta.milli,
              reason: entry.reason,
              at: new Date(entry.at),
              staffId: entry.staffId || null,
              staffName: entry.staffName,
              ref: entry.ref ?? null,
              note: entry.note ?? null,
            },
            select: LEDGER_SELECT,
          });
          created.push(toStockEntry(row));
        }
        return { ok: true as const, entries: created };
      });
    },

    /**
     * Reads `app.branch_stock`, the view that subtracts live reservations from
     * the ledger sum. Doing the subtraction in SQL rather than here means the
     * till, the manager's stock screen and the storefront's availability check
     * are all reading one definition of "available" — see docs/DATABASE.md §5.
     */
    async availability(branchId: string) {
      return db(async (tx) => {
        const rows = await tx.$queryRaw<
          { product_id: string; on_hand_milli: bigint; held_milli: bigint; available_milli: bigint }[]
        >`SELECT product_id, on_hand_milli, held_milli, available_milli
            FROM app.branch_stock
           WHERE branch_id = ${branchId}::uuid`;

        return new Map(
          rows.map((r) => [
            r.product_id,
            {
              onHandMilli: Number(r.on_hand_milli),
              heldMilli: Number(r.held_milli),
              availableMilli: Number(r.available_milli),
            },
          ]),
        );
      });
    },
  };
}

/* ── Sales ────────────────────────────────────────────────────────────────── */

const SALE_SELECT = {
  id: true,
  receiptNo: true,
  branchId: true,
  branchName: true,
  staffId: true,
  staffName: true,
  staffCode: true,
  subtotalKobo: true,
  discountKobo: true,
  totalKobo: true,
  changeKobo: true,
  status: true,
  at: true,
  takenOffline: true,
  syncedAt: true,
  customerId: true,
  customer: { select: { fullName: true } },
  pointsEarned: true,
  pointsRedeemed: true,
  lines: {
    select: {
      productId: true,
      name: true,
      sku: true,
      qtyMilli: true,
      soldBy: true,
      unit: true,
      unitPriceKobo: true,
      discountKobo: true,
      lineTotalKobo: true,
    },
  },
  tenders: { select: { method: true, amountKobo: true } },
} as const;

export function salesRepository(actor: Actor): SalesRepository {
  const db = dbFor(actor);
  return {
    async listForDay(day: string, branchId?: string) {
      const { from, to } = lagosDayBounds(day);
      return db(async (tx) => {
        const rows = await tx.sale.findMany({
          where: { at: { gte: from, lt: to }, ...(branchId ? { branchId } : {}) },
          orderBy: { at: "desc" },
          select: SALE_SELECT,
        });
        return rows.map(toSale);
      });
    },

    /**
     * The sale and the stock it moved, together or not at all.
     *
     * A sale that commits without its ledger movements is worse than a sale
     * that fails: the takings say the rice left the shop and the stock figure
     * says it is still on the shelf, and nobody can tell which is lying. One
     * transaction, so there is no window where only half of it is true.
     */
    async record(sale: Sale & { clientId: string }) {
      return db(async (tx) => {
        // A retry is not an error (rule 8). The till may have posted this
        // already and lost the response on the way back.
        const existing = await tx.sale.findUnique({
          where: { clientId: sale.clientId },
          select: SALE_SELECT,
        });
        if (existing) return { ok: true as const, sale: toSale(existing) };

        const created = await tx.sale.create({
          data: {
            clientId: sale.clientId,
            receiptNo: sale.receiptNo,
            branchId: sale.branchId,
            branchName: sale.branchName,
            staffId: sale.staffId,
            staffName: sale.staffName,
            staffCode: sale.staffCode,
            subtotalKobo: BigInt(sale.subtotal.kobo),
            discountKobo: BigInt(sale.discount.kobo),
            totalKobo: BigInt(sale.total.kobo),
            changeKobo: BigInt(sale.change.kobo),
            customerId: sale.customerId,
            pointsEarned: sale.pointsEarned,
            pointsRedeemed: sale.pointsRedeemed,
            status: sale.status,
            channel: "till",
            at: new Date(sale.at),
            takenOffline: sale.takenOffline,
            syncedAt: new Date(),
            lines: {
              create: sale.lines.map((line) => ({
                productId: line.productId,
                name: line.name,
                sku: line.sku,
                qtyMilli: line.quantity.milli,
                soldBy: line.soldBy,
                unit: line.unit,
                unitPriceKobo: BigInt(line.unitPrice.kobo),
                discountKobo: BigInt(line.discount.kobo),
                lineTotalKobo: BigInt(line.lineTotal.kobo),
              })),
            },
            tenders: {
              create: sale.tenders.map((t) => ({
                method: t.method,
                amountKobo: BigInt(t.amount.kobo),
              })),
            },
          },
          select: SALE_SELECT,
        });

        // The card moves in the same transaction as the sale.
        //
        // Points that are awarded but not committed — or spent and not
        // deducted — are the loyalty equivalent of a sale whose stock never
        // moved: the receipt says one thing and the balance says another, and
        // the customer is the one who finds out.
        if (sale.customerId) {
          if (sale.pointsRedeemed > 0) {
            await tx.loyaltyLedger.create({
              data: {
                customerId: sale.customerId,
                branchId: sale.branchId,
                deltaPoints: -sale.pointsRedeemed,
                reason: "REDEEM",
                ref: sale.receiptNo,
                at: new Date(sale.at),
              },
            });
          }
          if (sale.pointsEarned > 0) {
            await tx.loyaltyLedger.create({
              data: {
                customerId: sale.customerId,
                branchId: sale.branchId,
                deltaPoints: sale.pointsEarned,
                reason: "EARN",
                ref: sale.receiptNo,
                at: new Date(sale.at),
              },
            });
          }
          // Their last visit is the one fact about a customer the till updates.
          await tx.customer.update({
            where: { id: sale.customerId },
            data: { lastVisitAt: new Date(sale.at) },
          });
        }

        // The movements the sale caused. Negative, because stock left.
        for (const line of sale.lines) {
          if (line.quantity.milli === 0) continue;
          await tx.stockLedger.create({
            data: {
              branchId: sale.branchId,
              productId: line.productId,
              deltaMilli: -line.quantity.milli,
              reason: "SALE",
              channel: "till",
              at: new Date(sale.at),
              staffId: sale.staffId,
              staffName: sale.staffName,
              ref: sale.receiptNo,
            },
          });
        }

        return { ok: true as const, sale: toSale(created) };
      });
    },
  };
}


/* ── Purchase orders ──────────────────────────────────────────────────────── */

/**
 * Orders, mapped onto the richer screen type.
 *
 * The table predates supplier kind, notes and the who-did-what trail, so those
 * fill with honest defaults rather than invented values. What has arrived is
 * not read from `received_qty_milli` — screens derive it from the ledger, the
 * same way they do in fixture mode, so there is one definition of "received".
 *
 * The ledger table has no `order_ref` column yet, so a receipt booked through
 * the database names its order in `ref`; `orderProgress` accepts either.
 */
export function purchasingRepository(actor: Actor): PurchasingRepository {
  const db = dbFor(actor);
  return {
    async listOrders() {
      return db(async (tx) => {
        const rows = await tx.purchaseOrder.findMany({
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            reference: true,
            branchId: true,
            supplier: true,
            status: true,
            expectedOn: true,
            createdAt: true,
            updatedAt: true,
            lines: { select: { productId: true, qtyMilli: true, unitCostKobo: true } },
          },
        });
        return rows.map(
          (row): PurchaseOrder => ({
            id: row.id,
            reference: row.reference,
            branchId: row.branchId,
            supplier: row.supplier,
            supplierKind: "supplier",
            lines: row.lines.map((l) => ({
              productId: l.productId,
              quantity: quantity(l.qtyMilli),
              unitCost: money(l.unitCostKobo),
            })),
            expectedOn: row.expectedOn ? row.expectedOn.toISOString().slice(0, 10) : null,
            note: null,
            createdAt: row.createdAt.toISOString(),
            createdBy: "—",
            sentAt: row.status === "draft" ? null : row.createdAt.toISOString(),
            cancelledAt: row.status === "cancelled" ? row.updatedAt.toISOString() : null,
            cancelledBy: null,
            cancelReason: null,
          }),
        );
      });
    },
  };
}
