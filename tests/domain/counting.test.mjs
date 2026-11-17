/**
 * Stock counts — SPEC §10.3. The ledger meets the shelf.
 *
 *   npm run test:domain
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  balanceAt,
  bumpCount,
  countVariance,
  cutCountLines,
  lastCountedByProduct,
  pickCycleLines,
  planCountPosting,
} from "../../src/lib/domain/counting.ts";
import { naira } from "../../src/lib/domain/money.ts";
import { units } from "../../src/lib/domain/quantity.ts";

let seq = 0;
const move = (productId, delta, at, reason = "SALE") => ({
  id: `e${++seq}`,
  branchId: "b1",
  productId,
  delta: units(delta),
  reason,
  at,
  staffId: "s1",
  staffName: "Ada",
});

const ledger = [
  move("milk", 40, "2026-11-17T07:00:00Z", "PURCHASE_RECEIPT"),
  move("rice", 10, "2026-11-17T07:00:00Z", "PURCHASE_RECEIPT"),
  // Cut at 08:00. Twelve tins sell at 09:00, before the shelf is counted at 10:00.
  move("milk", -12, "2026-11-17T09:00:00Z"),
  { ...move("milk", 5, "2026-11-17T07:00:00Z", "PURCHASE_RECEIPT"), branchId: "b2" },
];
const cost = () => naira(100);
const CUT = "2026-11-17T08:00:00Z";

test("a sheet is cut at the ledger balance, per branch", () => {
  const lines = cutCountLines(ledger, "b1", ["milk", "rice", "eggs"], CUT);
  assert.deepEqual(lines.map((l) => l.expectedAtCut.milli), [40_000, 10_000, 0]);
  assert.ok(lines.every((l) => l.counted === null));
});

test("sales during the count are not shrinkage", () => {
  const sheet = {
    branchId: "b1",
    lines: [
      { productId: "milk", expectedAtCut: units(40), counted: units(28), countedAt: "2026-11-17T10:00:00Z" },
      { productId: "rice", expectedAtCut: units(10), counted: units(8), countedAt: "2026-11-17T10:05:00Z" },
    ],
  };
  const { rows, summary } = countVariance(sheet, ledger, cost, "2026-11-17T11:00:00Z");
  assert.equal(rows[0].expected.milli, 28_000);
  assert.equal(rows[0].variance.milli, 0); // 40 − 12 sold = 28 on the shelf
  assert.equal(rows[1].variance.milli, -2_000);
  assert.equal(rows[1].value.kobo, -20_000);
  assert.equal(rows[1].recount, true); // 20% off
  assert.equal(summary.matched, 1);
  assert.equal(summary.short, 1);
  assert.equal(summary.accuracyBp, 5_000);
  assert.equal(summary.netValue.kobo, -20_000);
});

test("an uncounted line is reported, never posted as zero", () => {
  const sheet = {
    branchId: "b1",
    reference: "CNT-1",
    lines: [{ productId: "rice", expectedAtCut: units(10), counted: null, countedAt: null }],
  };
  const { summary } = countVariance(sheet, ledger, cost, CUT);
  assert.equal(summary.uncounted, 1);
  assert.equal(summary.accuracyBp, null);
  assert.deepEqual(planCountPosting(sheet, ledger, { id: "s1", name: "Ada" }, CUT), []);
});

test("posting appends one COUNT_ADJUSTMENT per differing line, and the ledger then agrees", () => {
  const sheet = {
    branchId: "b1",
    reference: "CNT-GWA-1",
    lines: [
      { productId: "milk", expectedAtCut: units(40), counted: units(28), countedAt: "2026-11-17T10:00:00Z" },
      { productId: "rice", expectedAtCut: units(10), counted: units(11), countedAt: "2026-11-17T10:05:00Z" },
    ],
  };
  const now = "2026-11-17T11:00:00Z";
  const posted = planCountPosting(sheet, ledger, { id: "s9", name: "Bola" }, now);
  assert.equal(posted.length, 1);
  assert.equal(posted[0].reason, "COUNT_ADJUSTMENT");
  assert.equal(posted[0].delta.milli, 1_000);
  assert.equal(posted[0].ref, "CNT-GWA-1");
  assert.equal(posted[0].at, "2026-11-17T10:05:00Z");

  const after = [...ledger, { ...posted[0], id: "p1" }];
  assert.equal(balanceAt(after, "b1", "rice", now).milli, 11_000);
  // Recounting against the new ledger shows nothing left to post.
  assert.deepEqual(planCountPosting(sheet, after, { id: "s9", name: "Bola" }, now), []);
});

test("cycle counts pick the lines counted longest ago, never-counted first", () => {
  const last = lastCountedByProduct([
    { status: "posted", lines: [{ productId: "a", countedAt: "2026-11-01T00:00:00Z" }, { productId: "b", countedAt: "2026-10-01T00:00:00Z" }] },
    { status: "abandoned", lines: [{ productId: "c", countedAt: "2026-11-10T00:00:00Z" }] },
  ]);
  assert.deepEqual(pickCycleLines(["a", "b", "c", "d"], last, 3), ["c", "d", "b"]);
});

test("scan-to-count adds and never goes below zero", () => {
  assert.equal(bumpCount(null, units(1)).milli, 1_000);
  assert.equal(bumpCount(units(2), units(-5)).milli, 0);
});
