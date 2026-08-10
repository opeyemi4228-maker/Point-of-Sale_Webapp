/**
 * The loyalty scheme — the numbers, in one place.
 *
 * Every one of these is a commercial decision Swiftgrocers can change without
 * touching a line of logic. They live here rather than inside the arithmetic so
 * that changing the earn rate is a one-line edit somebody can reason about,
 * and so nobody has to grep for `100` to find out what a point is worth.
 *
 * All integers. A percentage that is really 1.5% belongs here as basis points,
 * not as a float multiplier scattered through the domain (CLAUDE.md rule 2).
 */

/**
 * Naira of spend that earns one point. ₦100 → 1 point.
 *
 * Rounded **down**: a ₦199 basket earns one point, not two. Awarding for a
 * fraction of the earning unit is how a scheme quietly costs more than the
 * spreadsheet said it would.
 */
export const NAIRA_PER_POINT = 100 as const;

/**
 * What one point is worth when it is spent. ₦1.
 *
 * With the earn rate above this is a flat 1% back, which is the number to quote
 * to a customer, and the only sentence a cashier needs: **"₦100 spent is a
 * point, and a point is ₦1 off."**
 */
export const KOBO_PER_POINT = 100 as const;

/**
 * Points that must be banked before any of them can be spent.
 *
 * This is what makes the scheme worth something tangible rather than a rounding
 * error printed on a receipt. At ₦1 a point, 500 points is ₦500 off a shop —
 * a real bag of rice, not a sachet of seasoning. Below the threshold the
 * balance still accrues and is still shown; it simply cannot be redeemed yet,
 * and the till says how far off the customer is.
 */
export const MINIMUM_REDEEMABLE_POINTS = 500 as const;

/**
 * Points are spent in blocks of 100 — ₦100 at a time.
 *
 * Redeeming an arbitrary 387 points leaves a receipt with an unreadable
 * discount and a balance nobody can predict. Blocks keep the maths mental: the
 * customer hears "₦400 off", the cashier keys nothing, and the remainder stays
 * on the card.
 */
export const REDEMPTION_BLOCK_POINTS = 100 as const;

/**
 * Tier thresholds, by lifetime spend in kobo.
 *
 * Lifetime spend rather than points held, deliberately: a customer who redeems
 * regularly is a *better* customer than one who hoards, and a tier that drops
 * when somebody spends their points punishes exactly the behaviour the scheme
 * exists to encourage.
 */
export const TIER_THRESHOLD_KOBO = {
  bronze: 0,
  silver: 25_000_000, // ₦250,000
  gold: 100_000_000, // ₦1,000,000
} as const;

/**
 * Extra points earned at each tier, as a whole percentage of the base award.
 *
 * Applied to the points, not to the money, so the result is always a whole
 * point and there is never a fraction to round twice.
 */
export const TIER_BONUS_PERCENT = {
  bronze: 0,
  silver: 25,
  gold: 50,
} as const;

/** How the tiers read on a screen. Never the only signal — always with text. */
export const TIER_LABEL = {
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
} as const;
