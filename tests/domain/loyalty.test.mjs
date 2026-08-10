/**
 * Loyalty arithmetic — SPEC §11.
 *
 * Points are money by another name, so these are checked the way the money
 * tests are: exact integers, no tolerance, and the awkward cases stated
 * explicitly rather than assumed.
 *
 *   node --test tests/domain/
 *
 * Run against the TypeScript source through `tsx`, so there is no build step
 * between what ships and what is tested.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  canRedeem,
  checkEnrolment,
  earnedOnSale,
  maskPhone,
  maximumRedeemable,
  normalisePhone,
  pointsBalance,
  pointsEarned,
  pointsToRedemption,
  pointsValue,
  redeem,
  spendToNextPoint,
  spendToNextTier,
  tierFor,
} from "../../src/lib/domain/loyalty.ts";
import { naira, kobo, ZERO } from "../../src/lib/domain/money.ts";

/* ── Balance ──────────────────────────────────────────────────────────────── */

test("a balance is the sum of the movements", () => {
  assert.equal(pointsBalance([]), 0);
  assert.equal(pointsBalance([{ delta: 120 }, { delta: 45 }]), 165);
});

test("a reversal cancels exactly, leaving both entries on the record", () => {
  const ledger = [{ delta: 250 }, { delta: -250 }];
  assert.equal(pointsBalance(ledger), 0);
  assert.equal(ledger.length, 2, "the ledger is append-only — nothing is removed");
});

test("a balance stays exact over a long ledger", () => {
  const ledger = Array.from({ length: 10_000 }, () => ({ delta: 3 }));
  assert.equal(pointsBalance(ledger), 30_000);
});

/* ── Earning ──────────────────────────────────────────────────────────────── */

test("₦100 spent is one point", () => {
  assert.equal(pointsEarned(naira(100)), 1);
});

test("earning rounds down — a fraction of the unit earns nothing", () => {
  assert.equal(pointsEarned(naira(199)), 1);
  assert.equal(pointsEarned(naira(99)), 0);
  assert.equal(pointsEarned(kobo(9_999)), 0);
});

test("nothing is earned on nothing, and never on a negative", () => {
  assert.equal(pointsEarned(ZERO), 0);
  assert.equal(pointsEarned(kobo(-50_000)), 0);
});

test("a realistic basket earns a whole number of points", () => {
  assert.equal(pointsEarned(naira(12_450)), 124);
});

test("tier bonus lands on the points, so the result is always whole", () => {
  assert.equal(pointsEarned(naira(10_000), "bronze"), 100);
  assert.equal(pointsEarned(naira(10_000), "silver"), 125);
  assert.equal(pointsEarned(naira(10_000), "gold"), 150);
  // 33 base at silver is 41.25 → 41. A whole point, rounded once.
  assert.equal(pointsEarned(naira(3_300), "silver"), 41);
});

test("the part of a bill paid with points earns nothing", () => {
  // ₦5,000 bill, ₦2,000 of it settled with points → only ₦3,000 earns.
  assert.equal(earnedOnSale(naira(5_000), naira(2_000)), 30);
});

test("a bill paid entirely with points earns nothing at all", () => {
  assert.equal(earnedOnSale(naira(1_000), naira(1_000)), 0);
});

test("points cannot compound into a currency", () => {
  // Over-redeeming must never produce negative spend and thus negative points.
  assert.equal(earnedOnSale(naira(1_000), naira(5_000)), 0);
});

test("spendToNextPoint says how far off the next point is", () => {
  assert.equal(spendToNextPoint(naira(150)).kobo, naira(50).kobo);
  // Exactly on the boundary: a whole unit away, not zero.
  assert.equal(spendToNextPoint(naira(100)).kobo, naira(100).kobo);
});

/* ── Tiers ────────────────────────────────────────────────────────────────── */

test("tiers are set by lifetime spend", () => {
  assert.equal(tierFor(ZERO), "bronze");
  assert.equal(tierFor(naira(249_999)), "bronze");
  assert.equal(tierFor(naira(250_000)), "silver");
  assert.equal(tierFor(naira(999_999)), "silver");
  assert.equal(tierFor(naira(1_000_000)), "gold");
});

test("the next tier is reported with what is left to spend", () => {
  assert.deepEqual(spendToNextTier(naira(100_000)), {
    tier: "silver",
    remaining: naira(150_000),
  });
  assert.equal(spendToNextTier(naira(2_000_000)), null, "gold is the top");
});

/* ── Redemption ───────────────────────────────────────────────────────────── */

test("points are not spendable until they are worth something tangible", () => {
  assert.equal(canRedeem(499), false);
  assert.equal(canRedeem(500), true);
  assert.equal(pointsToRedemption(320), 180);
  assert.equal(pointsToRedemption(900), 0);
});

test("a point is worth ₦1", () => {
  assert.equal(pointsValue(500).kobo, naira(500).kobo);
  assert.equal(pointsValue(0).kobo, 0);
});

test("below the threshold nothing can be taken off the bill", () => {
  assert.deepEqual(maximumRedeemable(499, naira(10_000)), {
    points: 0,
    value: ZERO,
  });
});

test("redemption is capped by the balance, in whole blocks", () => {
  // 640 points held → 600 usable, because points go 100 at a time.
  const most = maximumRedeemable(640, naira(10_000));
  assert.equal(most.points, 600);
  assert.equal(most.value.kobo, naira(600).kobo);
});

test("points are a discount, never a withdrawal", () => {
  // 5,000 points held against a ₦350 bill: the bill is the ceiling, and 300 is
  // the largest whole block that fits inside it.
  const most = maximumRedeemable(5_000, naira(350));
  assert.equal(most.points, 300);
  assert.ok(most.value.kobo <= naira(350).kobo);
});

test("a valid redemption is accepted", () => {
  const result = redeem(800, naira(5_000), 500);
  assert.deepEqual(result, { ok: true, points: 500, value: naira(500) });
});

test("a redemption bigger than the balance is refused, in words", () => {
  const result = redeem(300, naira(5_000), 500);
  assert.equal(result.ok, false);
  assert.match(result.reason, /more points needed|Only 300/);
});

test("a redemption bigger than the bill is refused", () => {
  const result = redeem(5_000, naira(200), 500);
  assert.equal(result.ok, false);
  assert.match(result.reason, /more than the bill/);
});

test("part-blocks are refused so the receipt stays readable", () => {
  const result = redeem(800, naira(5_000), 387);
  assert.equal(result.ok, false);
  assert.match(result.reason, /100 at a time/);
});

test("zero and fractional requests are refused", () => {
  assert.equal(redeem(800, naira(5_000), 0).ok, false);
  assert.equal(redeem(800, naira(5_000), 12.5).ok, false);
});

/* ── Enrolment ────────────────────────────────────────────────────────────── */

test("the three ways a Nigerian number is keyed are one customer", () => {
  const expected = "+2348031234567";
  assert.equal(normalisePhone("08031234567"), expected);
  assert.equal(normalisePhone("0803 123 4567"), expected);
  assert.equal(normalisePhone("+234 803 123 4567"), expected);
  assert.equal(normalisePhone("234 803 123 4567"), expected);
  assert.equal(normalisePhone("8031234567"), expected);
});

test("a number that is not a Nigerian mobile is rejected", () => {
  assert.equal(normalisePhone("12345"), null);
  assert.equal(normalisePhone("+44 7700 900123"), null);
  assert.equal(normalisePhone(""), null);
});

test("enrolment requires both a name and a number", () => {
  const noName = checkEnrolment({ fullName: "  ", phone: "08031234567" });
  assert.equal(noName.ok, false);
  assert.equal(noName.field, "fullName");

  const noPhone = checkEnrolment({ fullName: "Ada Obi", phone: "" });
  assert.equal(noPhone.ok, false);
  assert.equal(noPhone.field, "phone");
});

test("enrolment normalises what it accepts", () => {
  const result = checkEnrolment({ fullName: "  Ada   Obi ", phone: "0803 123 4567" });
  assert.deepEqual(result, {
    ok: true,
    fullName: "Ada Obi",
    phone: "+2348031234567",
  });
});

test("a phone number is masked everywhere it is listed", () => {
  assert.equal(maskPhone("+2348031234567"), "+234 803 ••• 4567");
  assert.equal(maskPhone("nonsense"), "•••");
});
