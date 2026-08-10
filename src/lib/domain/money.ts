import {
  CURRENCY_SYMBOL,
  LOCALE,
  MINOR_UNITS_PER_NAIRA,
} from "@/config/currency";

/**
 * Money — SPEC §19.
 *
 * An integer count of kobo, and nothing else. It is deliberately awkward to do
 * arithmetic on: you cannot add two `Money` values with `+`, because the moment
 * money is a plain `number` somebody eventually multiplies it by 1.075 and the
 * chain loses a kobo per line for the rest of its life.
 *
 * Pure. No I/O, no clock, no React.
 */
export type Money = {
  readonly kobo: number;
};

/* ── Construction ─────────────────────────────────────────────────────────── */

/** From whole and fractional naira, e.g. `naira(3_700.5)` → ₦3,700.50. */
export function naira(amount: number): Money {
  if (!Number.isFinite(amount)) {
    throw new RangeError(`Not a usable naira amount: ${amount}`);
  }
  return { kobo: halfUp(amount * MINOR_UNITS_PER_NAIRA) };
}

/** From an integer count of kobo — the canonical form. */
export function kobo(amount: number): Money {
  if (!Number.isInteger(amount)) {
    throw new RangeError(`Kobo must be a whole number, got ${amount}`);
  }
  return { kobo: amount };
}

export const ZERO: Money = { kobo: 0 };

/* ── Arithmetic ───────────────────────────────────────────────────────────── */

export function add(a: Money, b: Money): Money {
  return { kobo: a.kobo + b.kobo };
}

export function subtract(a: Money, b: Money): Money {
  return { kobo: a.kobo - b.kobo };
}

export function negate(a: Money): Money {
  return { kobo: -a.kobo };
}

export function abs(a: Money): Money {
  return { kobo: Math.abs(a.kobo) };
}

/**
 * Money × a plain quantity — a line total.
 *
 * SPEC §9.3: rounding is half-up to the kobo, **applied per line**. Quantities
 * carry 3 decimal places so weighed goods (§9.4) land here too.
 */
export function multiply(price: Money, quantity: number): Money {
  return { kobo: halfUp(price.kobo * quantity) };
}

/**
 * Sum a list of already-rounded lines.
 *
 * This is the only correct way to total a sale. Never compute a total from raw
 * inputs independently of its lines — it drifts from the printed lines by a
 * kobo or two and customers notice (§9.3).
 */
export function sum(amounts: readonly Money[]): Money {
  return { kobo: amounts.reduce((total, m) => total + m.kobo, 0) };
}

/* ── Comparison ───────────────────────────────────────────────────────────── */

export const isZero = (a: Money) => a.kobo === 0;
export const isNegative = (a: Money) => a.kobo < 0;
export const compare = (a: Money, b: Money) => a.kobo - b.kobo;

/* ── Formatting ───────────────────────────────────────────────────────────── */

const nairaFormat = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const wholeNairaFormat = new Intl.NumberFormat(LOCALE, {
  maximumFractionDigits: 0,
});

/** `₦25,570.00` — receipts, totals, anything the customer sees. */
export function format(amount: Money): string {
  const sign = amount.kobo < 0 ? "-" : "";
  const value = Math.abs(amount.kobo) / MINOR_UNITS_PER_NAIRA;
  return `${sign}${CURRENCY_SYMBOL}${nairaFormat.format(value)}`;
}

/** `₦25,570` — dense tables where the kobo is noise. */
export function formatWhole(amount: Money): string {
  const sign = amount.kobo < 0 ? "-" : "";
  const value = Math.abs(amount.kobo) / MINOR_UNITS_PER_NAIRA;
  return `${sign}${CURRENCY_SYMBOL}${wholeNairaFormat.format(Math.round(value))}`;
}

/**
 * `₦8.42M` — headline figures only, where the precise kobo would be unreadable
 * and is available elsewhere on the screen.
 */
export function formatCompact(amount: Money): string {
  const sign = amount.kobo < 0 ? "-" : "";
  const value = Math.abs(amount.kobo) / MINOR_UNITS_PER_NAIRA;

  if (value >= 1_000_000_000) return `${sign}${CURRENCY_SYMBOL}${trim(value / 1_000_000_000)}B`;
  if (value >= 1_000_000) return `${sign}${CURRENCY_SYMBOL}${trim(value / 1_000_000)}M`;
  if (value >= 1_000) return `${sign}${CURRENCY_SYMBOL}${trim(value / 1_000)}K`;
  return `${sign}${CURRENCY_SYMBOL}${wholeNairaFormat.format(Math.round(value))}`;
}

/** Bare naira, no symbol — for the receipt tape, which prints its own columns. */
export function formatBare(amount: Money): string {
  const sign = amount.kobo < 0 ? "-" : "";
  return `${sign}${nairaFormat.format(Math.abs(amount.kobo) / MINOR_UNITS_PER_NAIRA)}`;
}

export const toNaira = (amount: Money) => amount.kobo / MINOR_UNITS_PER_NAIRA;

/* ── Internals ────────────────────────────────────────────────────────────── */

/**
 * Half-up to a whole kobo — SPEC §9.3.
 *
 * `Math.round` is half-up for positives but rounds −0.5 *towards zero*, which
 * would round a refund line differently from the sale line it reverses. This
 * rounds away from zero on the half in both directions, so a reversal is always
 * exactly the negative of what it reverses.
 */
function halfUp(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

function trim(value: number): string {
  return value
    .toFixed(2)
    .replace(/\.?0+$/, "");
}
