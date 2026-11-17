import { units, type Quantity } from "@/lib/domain/quantity";
import type { StockEntry, StockSource } from "@/types/stock";
import type { StockReason } from "@/types/enums";
import { MOCK_BRANCHES } from "./branches";
import { MOCK_PRODUCTS } from "./catalog";

/**
 * FIXTURE DATA — deleted when the real stock endpoints land (SPEC §16).
 *
 * An append-only ledger, generated rather than hand-written: four branches over
 * twenty-three products is far too much to type honestly, and hand-written
 * fixtures always end up with balances that quietly disagree with the movements
 * that produced them — the exact bug rule 3 exists to prevent.
 *
 * Deterministic on purpose. Every value is a pure function of the product and
 * branch ids, with no `Math.random()` and no `Date.now()`, so the server and the
 * client render byte-identical output and nothing flickers on hydration.
 */

/**
 * FNV-1a over the seed string. Any stable hash would do; this one is short,
 * has no dependencies and spreads adjacent ids (`prd_omo` / `prd_soap`) into
 * unrelated buckets, which a naive character sum does not.
 */
function hash(seed: string): number {
  let value = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    value ^= seed.charCodeAt(i);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

/** A stable integer in [min, max] for a given seed. */
const pick = (seed: string, min: number, max: number): number =>
  min + (hash(seed) % (max - min + 1));

const STAFF = [
  { id: "stf_ifeoma", name: "Ifeoma Nwosu" },
  { id: "stf_blessing", name: "Blessing Achike" },
  { id: "stf_chidi", name: "Chidi Obi" },
  { id: "stf_ada", name: "Ada Mbeki" },
];

/** Fixed instants, so the ledger reads as a real week without a live clock. */
const DAY = [
  "2026-07-21T08:12:00Z",
  "2026-07-23T09:40:00Z",
  "2026-07-25T11:05:00Z",
  "2026-07-27T14:20:00Z",
  "2026-07-28T10:15:00Z",
];

function entry(
  id: string,
  branchId: string,
  productId: string,
  delta: Quantity,
  reason: StockReason,
  at: string,
  staffIndex: number,
  extra?: Partial<Pick<StockEntry, "ref" | "note" | "source" | "expiresOn" | "orderRef">>,
): StockEntry {
  const staff = STAFF[staffIndex % STAFF.length];
  return {
    id,
    branchId,
    productId,
    delta,
    reason,
    at,
    staffId: staff.id,
    staffName: staff.name,
    ...extra,
  };
}

/**
 * Where each category is bought from. Dry goods come down from the chain's own
 * warehouse; drinks and fresh lines are bought direct, because a supplier's van
 * gets bread and tomatoes to a branch a day sooner than the warehouse can.
 */
const SOURCE_BY_CATEGORY: Record<string, { source: StockSource; slot: number }> = {
  cat_staples: { source: { kind: "warehouse", name: "Swiftgrocers Central Warehouse" }, slot: 1 },
  cat_household: { source: { kind: "warehouse", name: "Swiftgrocers Central Warehouse" }, slot: 1 },
  cat_drinks: { source: { kind: "supplier", name: "Northgate Beverage Distributors" }, slot: 2 },
  cat_snacks: { source: { kind: "supplier", name: "Northgate Beverage Distributors" }, slot: 2 },
  cat_dairy: { source: { kind: "supplier", name: "Jos Fresh Farms Co-op" }, slot: 3 },
  cat_produce: { source: { kind: "supplier", name: "Jos Fresh Farms Co-op" }, slot: 3 },
};

/**
 * Best-before on the July delivery, per product. Household lines do not date.
 * Fixed calendar days, so the expiry screen shows a realistic spread: fresh
 * produce long gone, dairy and snacks near the line, dry goods well clear.
 */
const EXPIRES_ON: Record<string, string> = {
  prd_rice_5kg: "2027-06-30",
  prd_garri: "2027-01-31",
  prd_beans: "2027-01-15",
  prd_oil_3l: "2027-04-30",
  prd_sugar_1kg: "2027-12-31",
  prd_spaghetti: "2027-03-31",
  prd_water_75cl: "2027-05-31",
  prd_malt: "2027-01-31",
  prd_coke_50cl: "2027-02-28",
  prd_juice: "2026-11-20",
  prd_peak_400g: "2027-02-28",
  prd_eggs_crate: "2026-08-14",
  prd_butter: "2026-11-25",
  prd_tomatoes: "2026-07-30",
  prd_onions: "2026-08-20",
  prd_plantain: "2026-07-31",
  prd_yam: "2026-09-15",
  prd_biscuits: "2026-11-28",
  prd_gala: "2026-08-05",
  prd_groundnut: "2026-12-10",
};

/** One delivery per source per branch, so receipts group the way they arrived. */
function receiptDetail(branchId: string, productId: string, categoryId: string) {
  const { source, slot } = SOURCE_BY_CATEGORY[categoryId] ?? SOURCE_BY_CATEGORY.cat_staples;
  const code = branchId.slice(4, 7).toUpperCase();
  const document =
    source.kind === "warehouse"
      ? `WB-${4100 + (hash(branchId) % 400)}`
      : `INV-${7300 + (hash(`${branchId}${slot}`) % 600)}`;
  return {
    ref: `GRN-${code}-0723-0${slot}`,
    source: { ...source, document },
    ...(EXPIRES_ON[productId] ? { expiresOn: EXPIRES_ON[productId] } : {}),
  };
}

function buildLedger(): StockEntry[] {
  const entries: StockEntry[] = [];
  let sequence = 0;
  const nextId = () => `stk_${String(++sequence).padStart(5, "0")}`;

  for (const branch of MOCK_BRANCHES) {
    for (const product of MOCK_PRODUCTS) {
      // A delisted line still holds whatever was left when it was delisted; it
      // simply stops moving. Nothing is deleted (rule 4).
      if (product.delistedAt) {
        entries.push(
          entry(
            nextId(),
            branch.id,
            product.id,
            units(pick(`${branch.id}${product.id}old`, 0, 4)),
            "BRANCH_OPENED",
            DAY[0],
            0,
          ),
        );
        continue;
      }

      const seed = `${branch.id}:${product.id}`;
      const opening = pick(`${seed}:open`, 60, 160);
      const received = pick(`${seed}:recv`, 15, 60);

      // Sold is bounded by what the branch actually had. Picking it freely
      // drove most lines negative, which made "oversold" meaningless — the
      // point of that state is that it is rare and caused by something
      // specific, so the only oversold line in the fixture is the deliberate
      // offline one appended below.
      const available = opening + received;
      const sold = Math.min(pick(`${seed}:sold`, 8, 120), available - 20);

      entries.push(
        entry(nextId(), branch.id, product.id, units(opening), "BRANCH_OPENED", DAY[0], 0),
        entry(
          nextId(),
          branch.id,
          product.id,
          units(received),
          "PURCHASE_RECEIPT",
          DAY[1],
          pick(`${branch.id}:grn`, 0, 3),
          receiptDetail(branch.id, product.id, product.categoryId),
        ),
        entry(
          nextId(),
          branch.id,
          product.id,
          units(-sold),
          "SALE",
          DAY[3],
          pick(`${seed}:s`, 1, 3),
        ),
      );

      // A shrinkage movement on roughly one line in six, so the damage and
      // count-adjustment reasons are represented and the exception screens have
      // something real to show.
      const wobble = hash(`${seed}:wobble`) % 6;
      if (wobble === 0) {
        entries.push(
          entry(
            nextId(),
            branch.id,
            product.id,
            units(-pick(`${seed}:dmg`, 1, 4)),
            "DAMAGE",
            DAY[2],
            pick(`${seed}:d`, 0, 3),
            { note: "Crushed in transit" },
          ),
        );
      } else if (wobble === 1) {
        entries.push(
          entry(
            nextId(),
            branch.id,
            product.id,
            units(-pick(`${seed}:cnt`, 1, 3)),
            "COUNT_ADJUSTMENT",
            DAY[2],
            0,
            { note: "Monthly count" },
          ),
        );
      }
    }
  }

  /* ── The exceptions the manager overview already promises ───────────────── */

  // "1 offline oversell — Devon King's Oil 3L sold at −2 on Till 2 while
  // offline." The till kept trading without the network (rule 8) and its
  // movements landed late, taking the line below zero. The ledger reports that
  // honestly rather than clamping at zero, which is what makes it an exception.
  const oilBalance = balanceIn(entries, "brn_gwarinpa", "prd_oil_3l");
  entries.push(
    entry(
      nextId(),
      "brn_gwarinpa",
      "prd_oil_3l",
      units(-(oilBalance + 2)),
      "SALE",
      DAY[4],
      2,
      { ref: "SG-2026-0728-0442", note: "Synced late from Till 2 (offline)" },
    ),
  );

  // Tomatoes past their date, binned at Gwarinpa — the write-off register's
  // first entry. A day after the batch expired, as it would be in a real shop.
  entries.push(
    entry(nextId(), "brn_gwarinpa", "prd_tomatoes", units(-3.5), "EXPIRY", "2026-07-31T09:20:00Z", 0, {
      ref: "WO-GWA-0731-01",
      note: "Soft and split — binned",
      expiresOn: "2026-07-30",
    }),
    entry(nextId(), "brn_lekki", "prd_eggs_crate", units(-2), "EXPIRY", "2026-08-15T08:05:00Z", 0, {
      ref: "WO-LEK-0815-01",
      expiresOn: "2026-08-14",
    }),
  );

  // The seven lines the badge counts. Driven down to just under their reorder
  // level, so the low-stock screen and the sidebar badge agree.
  const lowLines = [
    "prd_peak_400g",
    "prd_sugar_1kg",
    "prd_eggs_crate",
    "prd_yam",
    "prd_butter",
    "prd_juice",
    "prd_tissue",
  ];

  for (const productId of lowLines) {
    const product = MOCK_PRODUCTS.find((p) => p.id === productId);
    if (!product) continue;

    const current = balanceIn(entries, "brn_gwarinpa", productId);
    const target = Math.max(0, Math.round(product.reorderLevel.milli / 1000) - 2);
    if (current > target) {
      entries.push(
        entry(
          nextId(),
          "brn_gwarinpa",
          productId,
          units(target - current),
          "SALE",
          DAY[4],
          1,
        ),
      );
    }
  }

  /* ── Deliveries against purchase orders ─────────────────────────────────── */
  //
  // Appended last, after the low-stock shaping above, because they are dated
  // after it — and none touches the seven deliberately-low lines above, so
  // the low-stock badge keeps meaning what it says. PO-0116 arrived in full; PO-0117 arrived short on garri and
  // without the rice; PO-0122 at Ikeja has its tomatoes and part of its eggs.
  for (const r of PO_RECEIPTS) {
    entries.push(
      entry(nextId(), r.branchId, r.productId, units(r.qty), "PURCHASE_RECEIPT", r.at, 0, {
        ref: r.grn,
        orderRef: r.orderRef,
        source: { kind: "supplier", name: r.supplier, document: r.invoice },
        ...(r.expiresOn ? { expiresOn: r.expiresOn } : {}),
      }),
    );
  }

  return entries;
}

const PO_RECEIPTS = [
  { orderRef: "PO-0116", grn: "GRN-GWA-260805-01", branchId: "brn_gwarinpa", supplier: "Chi Limited", invoice: "CHI-55120", at: "2026-08-05T10:20:00Z", productId: "prd_water_75cl", qty: 96, expiresOn: "2027-06-30" },
  { orderRef: "PO-0116", grn: "GRN-GWA-260805-01", branchId: "brn_gwarinpa", supplier: "Chi Limited", invoice: "CHI-55120", at: "2026-08-05T10:20:00Z", productId: "prd_malt", qty: 72, expiresOn: "2027-04-30" },
  { orderRef: "PO-0117", grn: "GRN-GWA-260809-01", branchId: "brn_gwarinpa", supplier: "Honeywell Flour Mills", invoice: "HFM-90314", at: "2026-08-09T12:05:00Z", productId: "prd_spaghetti", qty: 60, expiresOn: "2027-08-31" },
  { orderRef: "PO-0117", grn: "GRN-GWA-260809-01", branchId: "brn_gwarinpa", supplier: "Honeywell Flour Mills", invoice: "HFM-90314", at: "2026-08-09T12:05:00Z", productId: "prd_garri", qty: 20, expiresOn: "2027-05-31" },
  { orderRef: "PO-0122", grn: "GRN-IKE-261116-01", branchId: "brn_ikeja", supplier: "Jos Fresh Farms Co-op", invoice: "JFF-2231", at: "2026-11-16T07:40:00Z", productId: "prd_tomatoes", qty: 80, expiresOn: "2026-11-23" },
  { orderRef: "PO-0122", grn: "GRN-IKE-261116-01", branchId: "brn_ikeja", supplier: "Jos Fresh Farms Co-op", invoice: "JFF-2231", at: "2026-11-16T07:40:00Z", productId: "prd_eggs_crate", qty: 10, expiresOn: "2026-12-01" },
];

/** Running balance while the fixture is still being built. */
function balanceIn(
  entries: readonly StockEntry[],
  branchId: string,
  productId: string,
): number {
  let milli = 0;
  for (const e of entries) {
    if (e.branchId === branchId && e.productId === productId) milli += e.delta.milli;
  }
  return milli / 1000;
}

export const MOCK_STOCK_LEDGER: StockEntry[] = buildLedger();
