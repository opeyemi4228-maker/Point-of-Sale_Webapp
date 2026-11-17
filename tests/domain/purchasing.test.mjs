/**
 * Purchase orders and the stock-and-sales report — SPEC §7.7, §15.
 *
 * An order's progress is derived from ledger receipts, and the report's units
 * and values are derived from the same ledger. Both are checked here against
 * hand-worked figures.
 *
 *   npm run test:domain
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  onOrderByProduct,
  orderProgress,
  planOrder,
  planOrderReceipt,
  suggestedQuantity,
} from "../../src/lib/domain/purchasing.ts";
import { dailyTrade, productActivity } from "../../src/lib/domain/inventory.ts";
import { naira, ZERO } from "../../src/lib/domain/money.ts";
import { units } from "../../src/lib/domain/quantity.ts";

let seq = 0;
const move = (productId, delta, reason, at, extra = {}) => ({
  id: `m${++seq}`,
  branchId: "b1",
  productId,
  delta: units(delta),
  reason,
  at,
  staffId: "s1",
  staffName: "Ada",
  ...extra,
});

const order = (overrides = {}) => ({
  id: "po1",
  reference: "PO-0001",
  branchId: "b1",
  supplier: "Honeywell",
  supplierKind: "supplier",
  lines: [
    { productId: "pasta", quantity: units(60), unitCost: naira(800) },
    { productId: "garri", quantity: units(40), unitCost: naira(1_500) },
  ],
  expectedOn: "2026-11-10",
  note: null,
  createdAt: "2026-11-05T08:00:00Z",
  createdBy: "Ada",
  sentAt: "2026-11-05T08:05:00Z",
  cancelledAt: null,
  cancelledBy: null,
  cancelReason: null,
  ...overrides,
});

const receipt = (productId, qty, extra = {}) =>
  move(productId, qty, "PURCHASE_RECEIPT", "2026-11-09T10:00:00Z", { orderRef: "PO-0001", ...extra });

/* ── Order progress ───────────────────────────────────────────────────────── */

test("a sent order with nothing received is sent, and late once its day passes", () => {
  const p = orderProgress(order(), [], "2026-11-17");
  assert.equal(p.status, "sent");
  assert.equal(p.overdue, true);
  assert.equal(p.daysLate, 7);
  assert.deepEqual(p.orderedValue, naira(60 * 800 + 40 * 1_500));
  assert.deepEqual(p.outstandingValue, p.orderedValue);
});

test("a short delivery leaves the order part-received with the rest outstanding", () => {
  const p = orderProgress(order(), [receipt("pasta", 60), receipt("garri", 20)], "2026-11-09");
  assert.equal(p.status, "partially_received");
  assert.equal(p.overdue, false, "not late on the promised day itself");
  assert.deepEqual(p.lines[1].outstanding, units(20));
  assert.deepEqual(p.outstandingValue, naira(20 * 1_500));
});

test("received value is at the price actually paid, not the agreed one", () => {
  const p = orderProgress(
    order(),
    [receipt("pasta", 60, { unitCost: naira(850) }), receipt("garri", 40)],
    "2026-11-09",
  );
  assert.equal(p.status, "received");
  assert.deepEqual(p.receivedValue, naira(60 * 850 + 40 * 1_500));
  assert.deepEqual(p.outstandingValue, ZERO);
});

test("receipts for another branch or another order do not count", () => {
  const p = orderProgress(
    order(),
    [
      receipt("pasta", 60, { branchId: "b2" }),
      receipt("pasta", 60, { orderRef: "PO-0002" }),
      move("pasta", 60, "PURCHASE_RECEIPT", "2026-11-09T10:00:00Z"),
    ],
    "2026-11-09",
  );
  assert.equal(p.status, "sent");
});

test("cancelled wins over everything, and a draft is never late", () => {
  assert.equal(orderProgress(order({ cancelledAt: "2026-11-06T00:00:00Z" }), [], "2026-12-01").status, "cancelled");
  const draft = orderProgress(order({ sentAt: null }), [], "2026-12-01");
  assert.equal(draft.status, "draft");
  assert.equal(draft.overdue, false);
});

/* ── Raising and receiving ────────────────────────────────────────────────── */

const draftLine = (overrides = {}) => ({
  productId: "pasta",
  productName: "Spaghetti",
  soldBy: "unit",
  quantity: 10,
  unitCost: naira(800),
  ...overrides,
});

test("an order needs a supplier, real lines, and a delivery date that is not past", () => {
  const ok = planOrder({ supplier: "Honeywell", expectedOn: "2026-11-20", today: "2026-11-17", lines: [draftLine()] });
  assert.equal(ok.ok, true);

  const bad = planOrder({
    supplier: " ",
    expectedOn: "2026-11-01",
    today: "2026-11-17",
    lines: [draftLine(), draftLine({ quantity: 2.5 }), draftLine({ productId: "x", productName: "X", unitCost: ZERO })],
  });
  assert.equal(bad.ok, false);
  const fields = bad.problems.map((p) => p.field).sort();
  assert.deepEqual(fields, ["expectedOn", "lines", "quantity", "supplier", "unitCost"]);
});

test("receiving more than is outstanding is refused", () => {
  const progress = orderProgress(order(), [receipt("garri", 30)], "2026-11-17");
  const input = (productId, quantity) => ({
    productId,
    productName: productId,
    soldBy: "unit",
    quantity,
    unitCost: naira(1_500),
    expiresOn: "",
  });

  const over = planOrderReceipt(progress, [input("garri", 11)], "2026-11-17");
  assert.equal(over.ok, false);

  const ok = planOrderReceipt(progress, [input("pasta", 0), input("garri", 10)], "2026-11-17");
  assert.equal(ok.ok, true);
  assert.equal(ok.lines.length, 1, "a line left at zero is simply not received");
});

test("nothing can be received against a draft or a finished order", () => {
  const draft = orderProgress(order({ sentAt: null }), [], "2026-11-17");
  assert.equal(planOrderReceipt(draft, [], "2026-11-17").ok, false);
});

test("reorder suggestions count stock already on its way", () => {
  // Reorder at 20, 5 on hand: order up to 40.
  assert.equal(suggestedQuantity(units(5), units(20), units(0), "unit"), 35);
  // 30 already coming: nothing to order.
  assert.equal(suggestedQuantity(units(5), units(20), units(30), "unit"), 0);
  // Healthy: nothing.
  assert.equal(suggestedQuantity(units(25), units(20), units(0), "unit"), 0);

  const onOrder = onOrderByProduct([orderProgress(order(), [receipt("garri", 30)], "2026-11-17")]);
  assert.deepEqual(onOrder.get("garri"), units(10));
  assert.deepEqual(onOrder.get("pasta"), units(60));
});

/* ── Stock and sales: quantity and value ──────────────────────────────────── */

const pricing = {
  costOf: () => naira(600),
  priceOf: () => naira(1_000),
};

test("one row reconciles in units and values every column", () => {
  const entries = [
    move("pasta", 50, "BRANCH_OPENED", "2026-11-01T08:00:00Z"),
    move("pasta", 40, "PURCHASE_RECEIPT", "2026-11-10T08:00:00Z", { unitCost: naira(650) }),
    move("pasta", -2, "SALE", "2026-11-11T09:00:00Z", { ref: "R-1" }),
    move("pasta", -5, "SALE", "2026-11-11T10:00:00Z"),
    move("pasta", -3, "EXPIRY", "2026-11-12T09:00:00Z"),
    move("pasta", -4, "TRANSFER_OUT", "2026-11-12T10:00:00Z"),
    move("pasta", 1, "COUNT_ADJUSTMENT", "2026-11-13T10:00:00Z"),
  ];
  const sales = [
    {
      receiptNo: "R-1",
      status: "completed",
      lines: [{ productId: "pasta", lineTotal: naira(1_800) }], // discounted from 2,000
    },
  ];
  const row = productActivity(
    entries,
    sales,
    { from: "2026-11-05T00:00:00Z", to: "2026-11-20T00:00:00Z" },
    pricing,
  ).get("pasta");

  assert.deepEqual(row.opening, units(50));
  assert.deepEqual(row.purchased, units(40));
  assert.deepEqual(row.purchasedValue, naira(40 * 650));
  assert.deepEqual(row.sold, units(7));
  // 1,800 off the receipt, plus 5 × 1,000 estimated at shelf price.
  assert.deepEqual(row.salesValue, naira(6_800));
  assert.deepEqual(row.estimatedSales, naira(5_000));
  assert.deepEqual(row.costOfSales, naira(7 * 600));
  assert.deepEqual(row.grossProfit, naira(6_800 - 4_200));
  assert.deepEqual(row.wasted, units(3));
  assert.deepEqual(row.expired, units(3));
  assert.deepEqual(row.transfers, units(-4));
  assert.deepEqual(row.adjusted, units(1));
  assert.deepEqual(row.closing, units(50 + 40 - 7 - 3 - 4 + 1));
  assert.deepEqual(row.closingValue, naira(77 * 600));
});

test("daily trade adds up to the product rows", () => {
  const entries = [
    move("pasta", 40, "PURCHASE_RECEIPT", "2026-11-10T08:00:00Z", { ref: "GRN-1" }),
    move("pasta", -2, "SALE", "2026-11-10T09:00:00Z", { ref: "R-1" }),
    move("pasta", -1, "SALE", "2026-11-11T09:00:00Z", { ref: "R-2" }),
  ];
  const days = dailyTrade(
    entries,
    [],
    { from: "2026-11-10T00:00:00Z", to: "2026-11-12T00:00:00Z" },
    (iso) => iso.slice(0, 10),
    ["2026-11-10", "2026-11-11"],
    pricing,
  );
  assert.deepEqual(days.map((d) => d.salesValue), [naira(2_000), naira(1_000)]);
  assert.deepEqual(days.map((d) => d.purchasesValue), [naira(24_000), ZERO]);
  assert.deepEqual(days.map((d) => d.deliveries), [1, 0]);
  assert.deepEqual(days.map((d) => d.transactions), [1, 1]);
});
