/**
 * Till arithmetic — SPEC §11, §15.1.
 *
 * Split payment, change by note, and the scan multiplier. Checked the way the
 * money tests are: exact integers, awkward cases stated rather than assumed.
 *
 *   npm run test:domain
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  changeBreakdown,
  remainingDue,
} from "../../src/lib/domain/basket.ts";
import { parseScanEntry } from "../../src/lib/domain/catalog.ts";
import { naira, kobo, ZERO } from "../../src/lib/domain/money.ts";

/* ── Split payment ────────────────────────────────────────────────────────── */

test("nothing tendered leaves the whole bill due", () => {
  assert.deepEqual(remainingDue(naira(12_450), []), naira(12_450));
});

test("part by transfer, the rest by cash", () => {
  const total = naira(12_450);
  const afterTransfer = remainingDue(total, [{ amount: naira(10_000) }]);
  assert.deepEqual(afterTransfer, naira(2_450));
});

test("an overpaid bill owes nothing — the excess is change, not a negative due", () => {
  assert.deepEqual(remainingDue(naira(2_450), [{ amount: naira(3_000) }]), ZERO);
});

/* ── Change by note ───────────────────────────────────────────────────────── */

test("change is counted out in the fewest notes, largest first", () => {
  assert.deepEqual(changeBreakdown(naira(3_650)), {
    notes: [
      { naira: 1_000, count: 3 },
      { naira: 500, count: 1 },
      { naira: 100, count: 1 },
      { naira: 50, count: 1 },
    ],
    remainder: ZERO,
  });
});

test("what the notes cannot make is reported, never silently dropped", () => {
  const { notes, remainder } = changeBreakdown(kobo(1_275_50));
  assert.deepEqual(notes, [
    { naira: 1_000, count: 1 },
    { naira: 200, count: 1 },
    { naira: 50, count: 1 },
    { naira: 20, count: 1 },
    { naira: 5, count: 1 },
  ]);
  assert.deepEqual(remainder, kobo(50));
});

test("no change, no notes", () => {
  assert.deepEqual(changeBreakdown(ZERO), { notes: [], remainder: ZERO });
});

/* ── Scan multiplier ──────────────────────────────────────────────────────── */

test("a plain scan is one of the thing", () => {
  assert.deepEqual(parseScanEntry("5012345678900"), {
    code: "5012345678900",
    multiplier: 1,
  });
});

test("6* in front of a scan is six", () => {
  assert.deepEqual(parseScanEntry("6*5012345678900"), {
    code: "5012345678900",
    multiplier: 6,
  });
  assert.deepEqual(parseScanEntry(" 12 * SG-0417"), { code: "SG-0417", multiplier: 12 });
});

test("an x is never a multiplier — in-store codes can contain one", () => {
  assert.deepEqual(parseScanEntry("3XAB12"), { code: "3XAB12", multiplier: 1 });
});

test("a zero multiplier sells one, not none", () => {
  assert.deepEqual(parseScanEntry("0*5012345678900"), {
    code: "5012345678900",
    multiplier: 1,
  });
});
