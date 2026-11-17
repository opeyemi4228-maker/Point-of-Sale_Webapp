/**
 * Product performance — ABC, GMROI, sell-through and cover.
 *
 *   npm run test:domain
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { classifyPerformance, formatCenti, gmroiOf, summariseClasses } from "../../src/lib/domain/analytics.ts";
import { naira, ZERO } from "../../src/lib/domain/money.ts";
import { units, ZERO_QTY } from "../../src/lib/domain/quantity.ts";

const row = (productId, { sold = 0, sales = 0, profit = 0, opening = 0, closing = 0, openingValue = 0, closingValue = 0 } = {}) => ({
  productId,
  opening: units(opening),
  openingValue: naira(openingValue),
  purchased: ZERO_QTY,
  purchasedValue: ZERO,
  sold: units(sold),
  salesValue: naira(sales),
  estimatedSales: ZERO,
  costOfSales: naira(sales - profit),
  grossProfit: naira(profit),
  wasted: ZERO_QTY,
  wastedValue: ZERO,
  expired: ZERO_QTY,
  transfers: ZERO_QTY,
  adjusted: ZERO_QTY,
  closing: units(closing),
  closingValue: naira(closingValue),
});

const rows = [
  row("rice", { sold: 30, sales: 7_000, profit: 1_400, opening: 40, closing: 10, openingValue: 4_000, closingValue: 1_000 }),
  row("oil", { sold: 10, sales: 2_000, profit: 300, opening: 20, closing: 50, openingValue: 2_000, closingValue: 5_000 }),
  row("salt", { sold: 2, sales: 600, profit: 100, closing: 1, closingValue: 100 }),
  row("candle", { sold: 1, sales: 400, profit: 50, closing: 0 }),
  row("yam", { closing: 5, closingValue: 900 }),
  row("gone"),
];

test("ABC: the lines making the first 80% of sales are A, the next 15% B", () => {
  const byId = new Map(classifyPerformance(rows, 30).map((r) => [r.productId, r]));
  assert.equal(byId.get("rice").abc, "A"); // 70%
  assert.equal(byId.get("oil").abc, "A"); // takes the total over 80%
  assert.equal(byId.get("salt").abc, "B"); // 90% → 95%
  assert.equal(byId.get("candle").abc, "C");
  assert.equal(byId.get("yam").abc, "C"); // no sales
  assert.equal(byId.get("oil").cumulativeBp, 9_000);
});

test("margin, GMROI, sell-through and cover are integers", () => {
  const rice = classifyPerformance(rows, 30).find((r) => r.productId === "rice");
  assert.equal(rice.marginBp, 2_000);
  assert.equal(rice.averageStock.kobo, naira(2_500).kobo);
  assert.equal(rice.gmroiCenti, 56); // 1,400 ÷ 2,500
  assert.equal(rice.sellThroughBp, 7_500); // 30 ÷ 40
  assert.equal(rice.coverDays, 10); // 10 left at 1 a day
  assert.equal(formatCenti(rice.gmroiCenti), "0.56×");
});

test("movement: fast, slow, dead and idle", () => {
  const byId = new Map(classifyPerformance(rows, 30).map((r) => [r.productId, r]));
  assert.equal(byId.get("rice").movement, "fast"); // 10 days
  assert.equal(byId.get("oil").movement, "slow"); // 150 days
  assert.equal(byId.get("salt").movement, "steady"); // 15 days
  assert.equal(byId.get("yam").movement, "dead"); // stock, no sales
  assert.equal(byId.get("gone").movement, "idle");
  assert.equal(byId.get("gone").sellThroughBp, null);
});

test("class summaries and pooled GMROI", () => {
  const perf = classifyPerformance(rows, 30);
  const classes = summariseClasses(perf);
  assert.equal(classes.A.lines, 2);
  assert.equal(classes.A.sales.kobo, naira(9_000).kobo);
  assert.equal(classes.C.lines, 3);
  assert.equal(gmroiOf(perf.filter((r) => r.abc === "A")), Math.round((1_700 * 100) / 6_000));
});
