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

/** `17 Nov` — chart axes and compact day columns. */
const shortDateFormat = new Intl.DateTimeFormat(LOCALE, {
  day: "numeric",
  month: "short",
  timeZone: TIMEZONE,
});
/** Takes an ISO day (`2026-11-17`) or an instant. */
export const shortDate = (iso: string) =>
  safely(shortDateFormat, iso.length === 10 ? `${iso}T12:00:00Z` : iso);

/** `17 Nov 2026` — expiry dates, where the year matters. */
const dayDateFormat = new Intl.DateTimeFormat(LOCALE, {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: TIMEZONE,
});
export const dayDate = (iso: string) =>
  safely(dayDateFormat, iso.length === 10 ? `${iso}T12:00:00Z` : iso);

/**
 * The instants bounding a run of Lagos calendar days: from midnight at the
 * start of `fromDay` to midnight at the end of `toDay`.
 *
 * Lagos is West Africa Time, UTC+1 all year with no daylight saving, so the
 * offset is fixed rather than looked up.
 */
export function lagosDayRange(fromDay: string, toDay: string): { from: string; to: string } {
  const start = new Date(`${fromDay}T00:00:00+01:00`);
  const end = new Date(`${toDay}T00:00:00+01:00`);
  end.setUTCDate(end.getUTCDate() + 1);
  return { from: start.toISOString(), to: end.toISOString() };
}

/**
 * "Today", "Yesterday", or `Tuesday, 11 August 2026` — the heading over a
 * day's entries in a register. Days are Lagos days, compared as ISO dates.
 */
export function dayHeading(day: string, today: string): string {
  if (day === today) return "Today";
  const y = new Date(`${today}T12:00:00Z`);
  y.setUTCDate(y.getUTCDate() - 1);
  if (day === y.toISOString().slice(0, 10)) return "Yesterday";
  return longDate(`${day}T12:00:00Z`);
}

/**
 * `just now`, `25 min ago`, `3 h ago`, `yesterday`, `12 days ago` — how long
 * since something happened, for the line under an exact time. `now` is passed
 * in (see `useNow`) so this never reads a clock during render.
 */
export function relativeTime(iso: string, now: number): string {
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  if (ms < 60_000) return "just now";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return "yesterday";
  if (d < 60) return `${d} days ago`;
  const mo = Math.floor(d / 30);
  return mo < 24 ? `${mo} months ago` : `${Math.floor(d / 365)} years ago`;
}
