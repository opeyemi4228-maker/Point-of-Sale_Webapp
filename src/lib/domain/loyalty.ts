import {
  KOBO_PER_POINT,
  MINIMUM_REDEEMABLE_POINTS,
  NAIRA_PER_POINT,
  REDEMPTION_BLOCK_POINTS,
  TIER_BONUS_PERCENT,
  TIER_THRESHOLD_KOBO,
} from "@/config/loyalty";
import { MINOR_UNITS_PER_NAIRA } from "@/config/currency";
import { ZERO, kobo, type Money } from "./money";
import type { LoyaltyTier } from "@/types/enums";

/**
 * Loyalty — SPEC §11.
 *
 * The card is the phone number. There is no plastic and no app: a customer
 * gives their number at the counter, and that is the whole scheme from their
 * side.
 *
 * **Points are a ledger, exactly like stock** (CLAUDE.md rule 3). A balance is
 * the sum of every movement ever recorded, never a column somebody edits. To
 * correct a mistake you append the opposite movement, which leaves both the
 * error and the fix on the record — and means a customer can always be shown
 * why their balance is what it is.
 *
 * Points are whole numbers throughout. There is no such thing as half a point,
 * and the moment one exists somebody has to decide how to round it on a receipt
 * in front of a queue.
 *
 * Pure. No I/O, no clock, no React.
 */

const EARNING_UNIT_KOBO = NAIRA_PER_POINT * MINOR_UNITS_PER_NAIRA;

/* ── Balance ──────────────────────────────────────────────────────────────── */

/** A movement on the card. The ledger is a list of these and nothing else. */
export type PointsMovement = {
  readonly delta: number;
};

/**
 * The balance, which is the sum of the movements and is never stored.
 *
 * Exact at any length: these are integers, so a card with ten thousand
 * movements on it is as accurate as one with two.
 */
export function pointsBalance(movements: readonly PointsMovement[]): number {
  return movements.reduce((total, movement) => total + movement.delta, 0);
}

/* ── Tier ─────────────────────────────────────────────────────────────────── */

/**
 * The tier a lifetime spend earns.
 *
 * Spend, not points held — a customer who redeems regularly is a better
 * customer than one who hoards, and a tier that fell when somebody spent their
 * points would punish exactly the behaviour the scheme exists to encourage.
 */
export function tierFor(lifetimeSpend: Money): LoyaltyTier {
  if (lifetimeSpend.kobo >= TIER_THRESHOLD_KOBO.gold) return "gold";
  if (lifetimeSpend.kobo >= TIER_THRESHOLD_KOBO.silver) return "silver";
  return "bronze";
}

/** What the customer must still spend to reach the next tier. Null at gold. */
export function spendToNextTier(lifetimeSpend: Money): {
  tier: LoyaltyTier;
  remaining: Money;
} | null {
  const tier = tierFor(lifetimeSpend);
  if (tier === "gold") return null;
  const next = tier === "bronze" ? "silver" : "gold";
  return {
    tier: next,
    remaining: kobo(TIER_THRESHOLD_KOBO[next] - lifetimeSpend.kobo),
  };
}

/* ── Earning ──────────────────────────────────────────────────────────────── */

/**
 * Points earned on a spend.
 *
 * Two rules, both deliberate:
 *
 * **Rounded down.** A ₦199 basket earns one point, not two. Awarding for a
 * fraction of the earning unit is how a scheme quietly costs more than the
 * spreadsheet said it would.
 *
 * **Only on money.** Pass the amount actually *paid for*, not the sale total —
 * the caller subtracts anything settled with points first (see
 * `earnedOnSale`). Points earning points compounds a discount into a currency,
 * and it is not recoverable once it is loose in the ledger.
 */
export function pointsEarned(spend: Money, tier: LoyaltyTier = "bronze"): number {
  if (spend.kobo <= 0) return 0;

  const base = Math.floor(spend.kobo / EARNING_UNIT_KOBO);
  if (base === 0) return 0;

  // The bonus lands on the points, not the money, so the result is always a
  // whole point and there is never a fraction rounded twice.
  const bonus = Math.round((base * TIER_BONUS_PERCENT[tier]) / 100);
  return base + bonus;
}

/**
 * Points earned on a settled sale.
 *
 * The part of the bill paid with points earns nothing. `total` is what the
 * basket came to; `paidWithPoints` is the value of the points tendered against
 * it.
 */
export function earnedOnSale(
  total: Money,
  paidWithPoints: Money,
  tier: LoyaltyTier = "bronze",
): number {
  const paidWithMoney = kobo(Math.max(0, total.kobo - paidWithPoints.kobo));
  return pointsEarned(paidWithMoney, tier);
}

/** How much more must be spent to earn the next whole point. */
export function spendToNextPoint(spend: Money): Money {
  const remainder = spend.kobo % EARNING_UNIT_KOBO;
  return kobo(remainder === 0 ? EARNING_UNIT_KOBO : EARNING_UNIT_KOBO - remainder);
}

/* ── Redemption ───────────────────────────────────────────────────────────── */

/** What a number of points is worth as money. */
export const pointsValue = (points: number): Money =>
  kobo(Math.max(0, Math.trunc(points)) * KOBO_PER_POINT);

/** Whether a balance has reached the point of being worth spending. */
export const canRedeem = (balance: number): boolean =>
  balance >= MINIMUM_REDEEMABLE_POINTS;

/** Points still needed before any can be spent. Zero once the gate is passed. */
export const pointsToRedemption = (balance: number): number =>
  Math.max(0, MINIMUM_REDEEMABLE_POINTS - balance);

/**
 * The most a customer may take off *this* bill.
 *
 * Bounded by three things at once, and every one of them matters:
 *
 *   - the balance they actually hold;
 *   - the bill itself — points are a discount, never a withdrawal, so nobody
 *     leaves the shop with cash they did not bring in;
 *   - whole blocks, so the receipt reads "₦400 off" rather than "₦387 off" and
 *     the remaining balance is something the customer can predict.
 *
 * Returns zero when the balance has not reached the redemption threshold, which
 * is the same answer as having no points: nothing can be taken off today.
 */
export function maximumRedeemable(balance: number, billTotal: Money): {
  points: number;
  value: Money;
} {
  if (!canRedeem(balance)) return { points: 0, value: ZERO };

  const affordableByBill = Math.floor(billTotal.kobo / KOBO_PER_POINT);
  const usable = Math.min(balance, affordableByBill);
  const wholeBlocks =
    Math.floor(usable / REDEMPTION_BLOCK_POINTS) * REDEMPTION_BLOCK_POINTS;

  return { points: wholeBlocks, value: pointsValue(wholeBlocks) };
}

/**
 * Validate a redemption a cashier has asked for.
 *
 * Refusals carry a sentence written for the person reading it, because this one
 * is said out loud to a customer at the counter (SPEC §16).
 */
export type RedemptionResult =
  | { ok: true; points: number; value: Money }
  | { ok: false; reason: string };

export function redeem(
  balance: number,
  billTotal: Money,
  requestedPoints: number,
): RedemptionResult {
  if (requestedPoints <= 0) {
    return { ok: false, reason: "Enter how many points to use." };
  }
  if (!Number.isInteger(requestedPoints)) {
    return { ok: false, reason: "Points are whole numbers." };
  }
  if (!canRedeem(balance)) {
    const short = pointsToRedemption(balance);
    return {
      ok: false,
      reason: `${short} more ${short === 1 ? "point" : "points"} needed before points can be used.`,
    };
  }
  if (requestedPoints > balance) {
    return { ok: false, reason: `Only ${balance} points on this card.` };
  }
  if (requestedPoints % REDEMPTION_BLOCK_POINTS !== 0) {
    return {
      ok: false,
      reason: `Points are used ${REDEMPTION_BLOCK_POINTS} at a time.`,
    };
  }

  const value = pointsValue(requestedPoints);
  if (value.kobo > billTotal.kobo) {
    return { ok: false, reason: "That is more than the bill comes to." };
  }

  return { ok: true, points: requestedPoints, value };
}

/* ── Enrolment ────────────────────────────────────────────────────────────── */

/**
 * What enrolling asks for: a name and a number, and nothing else.
 *
 * Anything more is a form, and a form at a till with a queue behind it does not
 * get filled in — it gets skipped, and the customer never joins.
 */
export type Enrolment = {
  fullName: string;
  phone: string;
};

export type EnrolmentCheck =
  | { ok: true; fullName: string; phone: string }
  | { ok: false; field: keyof Enrolment; message: string };

/**
 * Nigerian mobile numbers, normalised to E.164.
 *
 * Accepts what people actually key: `08031234567`, `803 123 4567`,
 * `+234 803 123 4567`. All three are the same customer, and storing them as
 * three different strings is how one person ends up with three cards and none
 * of them worth anything.
 */
export function normalisePhone(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, "");

  const local = /^0(\d{10})$/.exec(digits);
  if (local) return `+234${local[1]}`;

  const bare = /^(\d{10})$/.exec(digits);
  if (bare) return `+234${bare[1]}`;

  const international = /^\+?234(\d{10})$/.exec(digits);
  if (international) return `+234${international[1]}`;

  return null;
}

/** Both fields are required to enrol — SPEC §11. */
export function checkEnrolment({ fullName, phone }: Enrolment): EnrolmentCheck {
  const name = fullName.trim().replace(/\s+/g, " ");

  if (!name) {
    return { ok: false, field: "fullName", message: "A name is needed for the card." };
  }
  if (name.length < 2) {
    return { ok: false, field: "fullName", message: "That name looks too short." };
  }

  if (!phone.trim()) {
    return { ok: false, field: "phone", message: "A phone number is the card." };
  }

  const normalised = normalisePhone(phone);
  if (!normalised) {
    return {
      ok: false,
      field: "phone",
      message: "That is not a Nigerian mobile number. Try 0803 123 4567.",
    };
  }

  return { ok: true, fullName: name, phone: normalised };
}

/**
 * `+234 803 •••  4567` — SPEC §17.
 *
 * A full list of customer phone numbers sitting on a screen in a back office is
 * exactly what should not be there, so the number is masked everywhere except
 * the single detail view a manager has to open deliberately.
 */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/^\+234/, "");
  if (digits.length !== 10) return "•••";
  return `+234 ${digits.slice(0, 3)} ••• ${digits.slice(-4)}`;
}
