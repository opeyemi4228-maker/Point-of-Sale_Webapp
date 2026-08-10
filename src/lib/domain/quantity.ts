/**
 * Quantity — SPEC §9.4.
 *
 * An integer count of thousandths of a unit, for the same reason `Money` is an
 * integer count of kobo: stock is an append-only ledger and a balance is the
 * sum of every movement ever recorded (CLAUDE.md rule 3). Sum a few hundred
 * float deltas and `0.1 + 0.2` compounds until the on-hand figure disagrees
 * with the count sheet by a gram — and then nobody trusts the number.
 *
 * Three decimal places, which is what weighed goods need: 1.250 kg of rice.
 * Goods sold by the unit use whole thousands and read as integers everywhere.
 *
 * Pure. No I/O, no clock, no React.
 */
export type Quantity = {
  readonly milli: number;
};

const MILLI_PER_UNIT = 1000;

/* ── Construction ─────────────────────────────────────────────────────────── */

/** From a decimal count, e.g. `units(1.25)` → 1.250. */
export function units(amount: number): Quantity {
  if (!Number.isFinite(amount)) {
    throw new RangeError(`Not a usable quantity: ${amount}`);
  }
  return { milli: halfUp(amount * MILLI_PER_UNIT) };
}

/** From an integer count of thousandths — the canonical form. */
export function milli(amount: number): Quantity {
  if (!Number.isInteger(amount)) {
    throw new RangeError(`Milli-units must be whole, got ${amount}`);
  }
  return { milli: amount };
}

export const ZERO_QTY: Quantity = { milli: 0 };
export const ONE: Quantity = { milli: MILLI_PER_UNIT };

/* ── Arithmetic ───────────────────────────────────────────────────────────── */

export const addQty = (a: Quantity, b: Quantity): Quantity => ({
  milli: a.milli + b.milli,
});

export const subtractQty = (a: Quantity, b: Quantity): Quantity => ({
  milli: a.milli - b.milli,
});

export const negateQty = (a: Quantity): Quantity => ({ milli: -a.milli });

/** Sum a ledger. Exact at any length, which is the whole point of the type. */
export const sumQty = (amounts: readonly Quantity[]): Quantity => ({
  milli: amounts.reduce((total, q) => total + q.milli, 0),
});

/* ── Comparison ───────────────────────────────────────────────────────────── */

export const isZeroQty = (a: Quantity) => a.milli === 0;
export const isNegativeQty = (a: Quantity) => a.milli < 0;
export const compareQty = (a: Quantity, b: Quantity) => a.milli - b.milli;
export const toNumber = (a: Quantity) => a.milli / MILLI_PER_UNIT;

/* ── Formatting ───────────────────────────────────────────────────────────── */

/**
 * `3` for whole units, `1.25` when there is a fraction — never `1.250`.
 *
 * A grid of trailing zeroes on goods that are only ever sold whole reads as
 * false precision, and a cashier reading "3.000 loaves" to a customer sounds
 * like a machine. Weighed goods keep exactly the decimals they carry.
 */
export function formatQty(amount: Quantity): string {
  const value = toNumber(amount);
  return Number.isInteger(value) ? String(value) : trimTrailingZeroes(value);
}

/** `1.250 kg` / `3 ×` — a quantity with the unit it is counted in. */
export function formatQtyWithUnit(amount: Quantity, unit: string): string {
  return `${formatQty(amount)} ${unit}`;
}

/* ── Internals ────────────────────────────────────────────────────────────── */

/** Away from zero on the half, so a reversal is exactly the negative of a sale. */
function halfUp(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

function trimTrailingZeroes(value: number): string {
  return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}
