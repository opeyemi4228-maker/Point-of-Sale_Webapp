/**
 * Currency — Nigerian Naira. This is the only currency in the system.
 *
 * There is no multi-currency support and none is planned. Every amount, in every
 * table, on every screen and every receipt, is NGN. Do not add a currency field,
 * a currency selector, or a locale that formats as anything else.
 *
 * Money is stored and computed as an integer count of KOBO (SPEC §19).
 * Floating-point arithmetic on currency is a build error.
 */

export const CURRENCY_CODE = "NGN" as const;
export const CURRENCY_SYMBOL = "₦" as const;

/** 100 kobo = ₦1. The minor unit money is stored in. */
export const MINOR_UNITS_PER_NAIRA = 100 as const;

/** Presentation locale. Nigerian English — DD/MM/YYYY, comma thousands. */
export const LOCALE = "en-NG" as const;

/** SPEC §7 — timestamps are UTC, formatted to Lagos at the presentation layer only. */
export const TIMEZONE = "Africa/Lagos" as const;

/**
 * Cash rounding to the nearest ₦5 is a branch setting (SPEC §9.3), applied only
 * to the cash tender and recorded as a separate rounding adjustment.
 */
export const CASH_ROUNDING_STEP_NAIRA = 5 as const;
