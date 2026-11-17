/**
 * Inventory control — SPEC §7.7, §10.
 *
 * Deliveries, adjustments, expiry and the reconciliation report. The ledger
 * is the only truth, so every test builds one and checks what is derived.
 *
 *   npm run test:domain
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  batchesOnHand,
  daysBetween,
  deliveriesFrom,
  isIsoDay,
  planAdjustment,
  planDelivery,
  reconcile,
  shiftDay,
  summariseSales,
  writeOffRegister,
} from "../../src/lib/domain/inventory.ts";
import { naira, kobo, ZERO } from "../../src/lib/domain/money.ts";
import { units } from "../../src/lib/domain/quantity.ts";
import { balanceOf } from "../../src/lib/domain/stock.ts";

let seq = 0;
const move = (productId, delta, reason, at, extra = {}) => ({
  id: `e${++seq}`,
  branchId: "b1",
  productId,
  delta: units(delta),
  reason,
  at,
  staffId: "s1",
  staffName: "Ada",
  ...extra,
});

/* ── Days ─────────────────────────────────────────────────────────────────── */

test("calendar arithmetic crosses months and years", () => {
  assert.equal(shiftDay("2026-12-31", 1), "2027-01-01");
  assert.equal(shiftDay("2026-03-01", -1), "2026-02-28");
  assert.equal(daysBetween("2026-11-17", "2026-11-20"), 3);
  assert.equal(daysBetween("2026-11-17", "2026-11-10"), -7);
});

test("an impossible date is not a date", () => {
  assert.equal(isIsoDay("2026-02-30"), false);
  assert.equal(isIsoDay("2026-2-3"), false);
  assert.equal(isIsoDay("2028-02-29"), true);
});

/* ── Reconciliation ───────────────────────────────────────────────────────── */

test("opening plus every movement equals closing, and equals the ledger balance", () => {
  const entries = [
    move("p1", 100, "BRANCH_OPENED", "2026-11-01T08:00:00Z"),
    move("p1", 40, "PURCHASE_RECEIPT", "2026-11-10T08:00:00Z"),
    move("p1", -25, "SALE", "2026-11-11T12:00:00Z"),
    move("p1", 2, "REFUND", "2026-11-11T15:00:00Z"),
    move("p1", -6, "EXPIRY", "2026-11-12T09:00:00Z"),
    move("p1", -1, "DAMAGE", "2026-11-12T10:00:00Z"),
    move("p1", -3, "TRANSFER_OUT", "2026-11-13T10:00:00Z"),
    move("p1", 1, "COUNT_ADJUSTMENT", "2026-11-14T10:00:00Z"),
    // After the window: must not move the report.
    move("p1", -50, "SALE", "2026-11-20T10:00:00Z"),
  ];
  const range = { from: "2026-11-05T00:00:00Z", to: "2026-11-15T00:00:00Z" };
  const row = reconcile(entries, range).get("p1");

  assert.deepEqual(row.opening, units(100));
  assert.deepEqual(row.received, units(40));
  assert.deepEqual(row.sold, units(-23));
  assert.deepEqual(row.expired, units(-6));
  assert.deepEqual(row.losses, units(-1));
  assert.deepEqual(row.transfers, units(-3));
  assert.deepEqual(row.adjusted, units(1));
  assert.deepEqual(row.closing, units(108));

  const across =
    row.opening.milli + row.received.milli + row.transfers.milli + row.sold.milli +
    row.expired.milli + row.losses.milli + row.adjusted.milli;
  assert.equal(across, row.closing.milli);

  const upToWindowEnd = entries.filter((e) => e.at < range.to);
  assert.deepEqual(row.closing, balanceOf(upToWindowEnd, "b1", "p1"));
});

/* ── Deliveries ───────────────────────────────────────────────────────────── */

test("receipts regroup into the deliveries they arrived on, valued per line", () => {
  const source = { kind: "supplier", name: "Jos Fresh Farms Co-op", document: "INV-7351" };
  const entries = [
    move("p1", 10, "PURCHASE_RECEIPT", "2026-11-10T08:00:00Z", { ref: "GRN-1", source, unitCost: naira(1_250.5) }),
    move("p2", 3, "PURCHASE_RECEIPT", "2026-11-10T08:00:00Z", { ref: "GRN-1", source }),
    move("p1", 5, "PURCHASE_RECEIPT", "2026-11-12T08:00:00Z", { ref: "GRN-2" }),
    move("p1", -2, "SALE", "2026-11-12T09:00:00Z"),
  ];
  const deliveries = deliveriesFrom(entries, () => naira(100));

  assert.equal(deliveries.length, 2);
  assert.equal(deliveries[0].ref, "GRN-2", "newest first");
  const grn1 = deliveries[1];
  assert.equal(grn1.lines.length, 2);
  assert.deepEqual(grn1.source, source);
  // 10 × ₦1,250.50 at the price paid, 3 × ₦100 from the catalog fallback.
  assert.deepEqual(grn1.value, naira(12_505 + 300));
});

const draft = (overrides = {}) => ({
  source: { kind: "warehouse", name: "Central Warehouse", document: "" },
  receivedOn: "2026-11-17",
  lines: [
    {
      productId: "p1",
      productName: "Peak Milk",
      soldBy: "unit",
      quantity: 24,
      unitCost: naira(950),
      expiresOn: "2027-02-28",
    },
  ],
  ...overrides,
});

test("a clean delivery plans into ledger-ready lines", () => {
  const plan = planDelivery(draft());
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.lines[0].quantity, units(24));
  assert.equal(plan.lines[0].expiresOn, "2027-02-28");
  assert.equal(plan.source.document, undefined, "an empty document is dropped, not stored blank");
});

test("stock already at its date is refused at the door", () => {
  const plan = planDelivery(
    draft({ lines: [{ ...draft().lines[0], expiresOn: "2026-11-17" }] }),
  );
  assert.equal(plan.ok, false);
  assert.equal(plan.problems[0].field, "expiresOn");
});

test("every problem is reported at once", () => {
  const plan = planDelivery(
    draft({
      source: { kind: "supplier", name: "  ", document: "" },
      lines: [{ ...draft().lines[0], quantity: 2.5, unitCost: kobo(-1) }],
    }),
  );
  assert.equal(plan.ok, false);
  assert.deepEqual(
    plan.problems.map((p) => p.field).sort(),
    ["quantity", "source", "unitCost"],
  );
});

/* ── Adjustments ──────────────────────────────────────────────────────────── */

const adjust = (overrides) =>
  planAdjustment({
    direction: "remove",
    reason: "EXPIRY",
    quantity: 4,
    soldBy: "unit",
    onHand: units(10),
    note: "",
    ...overrides,
  });

test("a removal is a negative delta and an addition a positive one", () => {
  assert.deepEqual(adjust({}).delta, units(-4));
  assert.deepEqual(
    adjust({ direction: "add", reason: "COUNT_ADJUSTMENT" }).delta,
    units(4),
  );
});

test("you cannot write off more than the ledger holds", () => {
  const plan = adjust({ quantity: 11 });
  assert.equal(plan.ok, false);
  assert.equal(plan.problems[0].field, "quantity");
  assert.equal(adjust({ onHand: units(-2), quantity: 1 }).ok, false);
});

test("theft and corrections need a note; expiry does not", () => {
  assert.equal(adjust({ reason: "THEFT" }).ok, false);
  assert.equal(adjust({ reason: "THEFT", note: "Two tins gone from aisle 3" }).ok, true);
  assert.equal(adjust({ reason: "EXPIRY" }).ok, true);
});

test("a sale cannot be keyed by hand as an adjustment", () => {
  assert.equal(adjust({ reason: "SALE" }).ok, false);
});

test("whole units stay whole; weights keep three decimals", () => {
  assert.equal(adjust({ quantity: 1.5 }).ok, false);
  assert.deepEqual(adjust({ soldBy: "weight", quantity: 1.005 }).delta, units(-1.005));
  assert.equal(adjust({ soldBy: "weight", quantity: 1.0005 }).ok, false);
});

/* ── Expiry ───────────────────────────────────────────────────────────────── */

test("on-hand is allocated to the newest deliveries first", () => {
  const entries = [
    move("milk", 10, "PURCHASE_RECEIPT", "2026-10-01T08:00:00Z", { expiresOn: "2026-11-10" }),
    move("milk", 20, "PURCHASE_RECEIPT", "2026-11-05T08:00:00Z", { expiresOn: "2026-12-20" }),
    move("milk", -5, "SALE", "2026-11-06T08:00:00Z"),
  ];
  const batches = batchesOnHand(entries, { today: "2026-11-17", soonDays: 7 });

  // 25 on hand: 20 from the new batch, so 5 of the old one are still out there.
  assert.equal(batches.length, 2);
  assert.equal(batches[0].status, "expired");
  assert.deepEqual(batches[0].remaining, units(5));
  assert.equal(batches[0].daysLeft, -7);
  assert.equal(batches[1].status, "fresh");
  assert.deepEqual(batches[1].remaining, units(20));
});

test("writing off the expired units drains the old batch off the list", () => {
  const entries = [
    move("milk", 10, "PURCHASE_RECEIPT", "2026-10-01T08:00:00Z", { expiresOn: "2026-11-10" }),
    move("milk", 20, "PURCHASE_RECEIPT", "2026-11-05T08:00:00Z", { expiresOn: "2026-12-20" }),
    move("milk", -5, "SALE", "2026-11-06T08:00:00Z"),
    move("milk", -5, "EXPIRY", "2026-11-17T09:00:00Z"),
  ];
  const batches = batchesOnHand(entries, { today: "2026-11-17", soonDays: 7 });
  assert.equal(batches.filter((b) => b.status === "expired").length, 0);
});

test("the expiry day itself counts as expired; a week out counts as soon", () => {
  const entries = [
    move("a", 5, "PURCHASE_RECEIPT", "2026-11-01T08:00:00Z", { expiresOn: "2026-11-17" }),
    move("b", 5, "PURCHASE_RECEIPT", "2026-11-01T08:00:00Z", { expiresOn: "2026-11-24" }),
  ];
  const [a, b] = batchesOnHand(entries, { today: "2026-11-17", soonDays: 7 });
  assert.equal(a.status, "expired");
  assert.equal(b.status, "soon");
});

/* ── Register ─────────────────────────────────────────────────────────────── */

test("a reversed write-off stays in the register, marked with its reversal", () => {
  const writeOff = move("p1", -4, "EXPIRY", "2026-11-12T09:00:00Z", { ref: "WO-1" });
  const reversal = move("p1", 4, "CORRECTION", "2026-11-12T10:00:00Z", { ref: writeOff.id });
  const register = writeOffRegister(
    [writeOff, move("p1", -1, "DAMAGE", "2026-11-13T09:00:00Z"), reversal],
    () => naira(500),
  );

  assert.equal(register.length, 2);
  const expired = register.find((w) => w.entry.id === writeOff.id);
  assert.equal(expired.reversedBy.id, reversal.id);
  assert.deepEqual(expired.value, naira(2_000));
});

/* ── Sales ────────────────────────────────────────────────────────────────── */

test("voided sales are not takings, and empty days still appear", () => {
  const sale = (id, total, status, at) => ({
    id,
    status,
    at,
    total: naira(total),
    lines: [
      {
        productId: "p1",
        name: "Rice",
        sku: "SG-1",
        quantity: units(1),
        soldBy: "unit",
        unit: "ea",
        unitPrice: naira(total),
        discount: ZERO,
        lineTotal: naira(total),
      },
    ],
  });
  const summary = summariseSales(
    [
      sale("s1", 5_000, "completed", "2026-11-16T10:00:00Z"),
      sale("s2", 3_000, "voided", "2026-11-16T11:00:00Z"),
      sale("s3", 2_000, "completed", "2026-11-17T10:00:00Z"),
    ],
    { from: "2026-11-15T00:00:00Z", to: "2026-11-18T00:00:00Z" },
    (iso) => iso.slice(0, 10),
    ["2026-11-15", "2026-11-16", "2026-11-17"],
  );

  assert.deepEqual(summary.revenue, naira(7_000));
  assert.equal(summary.transactions, 2);
  assert.deepEqual(summary.averageBasket, naira(3_500));
  assert.deepEqual(
    summary.byDay.map((d) => d.transactions),
    [0, 1, 1],
  );
});

test("stock as at a past moment ignores everything after it", async () => {
  const { balancesAsAt } = await import("../../src/lib/domain/inventory.ts");
  const entries = [
    move("p1", 100, "BRANCH_OPENED", "2026-11-01T08:00:00Z"),
    move("p1", -30, "SALE", "2026-11-05T12:00:00Z"),
    move("p1", 20, "PURCHASE_RECEIPT", "2026-11-10T08:00:00Z"),
    { ...move("p1", 999, "PURCHASE_RECEIPT", "2026-11-02T08:00:00Z"), branchId: "b2" },
  ];
  // Close of 5 Nov, Lagos (23:00Z): opening less the sale, nothing after.
  const at5th = balancesAsAt(entries, "b1", "2026-11-05T23:00:00.000Z").get("p1");
  assert.deepEqual(at5th.onHand, units(70));
  assert.equal(at5th.lastMovedAt, "2026-11-05T12:00:00Z");
  // A movement exactly at the cut is after it, not before.
  assert.deepEqual(balancesAsAt(entries, "b1", "2026-11-10T08:00:00Z").get("p1").onHand, units(70));
  assert.equal(balancesAsAt(entries, "b1", "2026-10-31T00:00:00Z").get("p1"), undefined);
});

test("an expiry write-off that names its batch drains that batch, even under older stock", async () => {
  const { batchesOnHand } = await import("../../src/lib/domain/inventory.ts");
  const base = [
    move("tom", 100, "BRANCH_OPENED", "2026-07-01T08:00:00Z"), // undated, older
    move("tom", 49, "PURCHASE_RECEIPT", "2026-07-23T08:00:00Z", { expiresOn: "2026-07-30" }),
  ];
  const pull = move("tom", -10, "EXPIRY", "2026-11-17T07:37:00Z", { expiresOn: "2026-07-30" });
  const opts = { today: "2026-11-17", soonDays: 7 };

  assert.deepEqual(batchesOnHand(base, opts)[0].remaining, units(49));
  assert.deepEqual(batchesOnHand([...base, pull], opts)[0].remaining, units(39));

  // Pull the rest: the batch leaves the list.
  const rest = move("tom", -39, "EXPIRY", "2026-11-17T08:00:00Z", { expiresOn: "2026-07-30" });
  assert.equal(batchesOnHand([...base, pull, rest], opts).length, 0);

  // Reverse the first pull: its 10 go back on the batch.
  const reversal = move("tom", 10, "CORRECTION", "2026-11-17T09:00:00Z", { ref: pull.id });
  assert.deepEqual(batchesOnHand([...base, pull, rest, reversal], opts)[0].remaining, units(10));
});
