import { LOCALE, TIMEZONE } from "@/config/currency";

/**
 * Dates are stored UTC and formatted to Africa/Lagos at the presentation layer
 * only (SPEC §7). The timezone is pinned explicitly rather than left to the
 * device, so a till whose clock is set wrong still prints a Lagos date.
 */

const longDateFormat = new Intl.DateTimeFormat(LOCALE, {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: TIMEZONE,
});

const shortTimeFormat = new Intl.DateTimeFormat(LOCALE, {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: TIMEZONE,
});

/**
 * An unusable timestamp renders as a dash rather than taking the screen down.
 *
 * `Intl.DateTimeFormat.format` throws a `RangeError` on an invalid date, and
 * that throw happens inside a render — so one malformed row does not produce
 * one bad cell, it produces a blank dashboard and a stack trace. On a till,
 * that is the difference between a manager squinting at a missing time and a
 * shop that cannot see its takings (CLAUDE.md rule 8, applied to rendering).
 *
 * It is a guard, not a licence: a dash on screen means somebody wrote a
 * timestamp that is not an ISO instant, and that is still a bug to fix at the
 * source.
 */
function safely(format: Intl.DateTimeFormat, iso: Date | string): string {
  const at = typeof iso === "string" ? new Date(iso) : iso;
  return Number.isNaN(at.getTime()) ? "—" : format.format(at);
}

/** `Tuesday, 28 July 2026` */
export const longDate = (iso: string) => safely(longDateFormat, iso);

/** `14:32` */
export const shortTime = (iso: string) => safely(shortTimeFormat, iso);

const isoDayFormat = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: TIMEZONE,
});

/**
 * `2026-07-28` — the Lagos calendar day, not the UTC one.
 *
 * `toISOString().slice(0, 10)` would be the UTC day, which is the *previous*
 * day for anything rung between midnight and 01:00 Lagos time. A till trading
 * late would file those sales under yesterday and the day's takings would not
 * match the drawer.
 */
export const isoDay = (at: Date | string = new Date()) =>
  safely(isoDayFormat, at);

/** The Lagos calendar day right now. */
export const todayInLagos = () => isoDay(new Date());

/** `28 Jul 2026, 14:32` — receipts and history rows. */
const stampFormat = new Intl.DateTimeFormat(LOCALE, {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: TIMEZONE,
});
export const stamp = (iso: string) => safely(stampFormat, iso);
