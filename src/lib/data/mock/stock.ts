import { units, type Quantity } from "@/lib/domain/quantity";
import type { StockEntry } from "@/types/stock";
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
  extra?: { ref?: string; note?: string },
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
          pick(seed, 0, 3),
          { ref: `PO-${1400 + (hash(seed) % 60)}` },
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

  return entries;
}

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
