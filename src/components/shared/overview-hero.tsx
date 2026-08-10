import Link from "next/link";
import { ArrowRight, CircleAlert } from "lucide-react";

/**
 * The banner at the top of an overview screen — SPEC §15.2.
 *
 * One figure, said once, at the size it deserves: the money taken today. A
 * manager glances at this from across the back office, so it is set in display
 * type on a filled ground rather than as another tile in a row of tiles.
 *
 * The ground is `market`, not the lighter `leaf` from the logo. Leaf carries
 * white at 3.06:1 — fine behind a shape, not behind the 13px label — while
 * market clears 5.22:1, so every piece of text on this card is legible at every
 * size. There is no watermark behind it: a mark at 9% on a gradient does not
 * read as a mark, it reads as a printing fault.
 *
 * When something is over a limit the count rides in the same card, above the
 * fold and inside the first thing the eye lands on. §15.2 puts exceptions
 * before numbers, and a banner that showed only good news would bury them.
 */
export function OverviewHero({
  eyebrow,
  value,
  valueLabel,
  detail,
  alert,
  action,
}: {
  eyebrow: string;
  value: string;
  /** Read out in place of the abbreviated figure, e.g. "₦1,284,500.00". */
  valueLabel: string;
  detail: string;
  alert?: { count: number; href: string; label: string };
  action?: React.ReactNode;
}) {
  return (
    <section className="relative overflow-hidden rounded-panel bg-linear-to-br from-market-dark via-market to-market px-6 py-6 shadow-raised sm:px-8 sm:py-7">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
        <div className="min-w-0">
          <p className="text-label uppercase text-white/75">{eyebrow}</p>

          <p className="mt-2 font-display text-display-xl leading-none font-black text-white">
            <span aria-hidden>{value}</span>
            <span className="sr-only">{valueLabel}</span>
          </p>

          <p className="font-numeric mt-2.5 text-body-lg text-white/80">{detail}</p>
        </div>

        {action}
      </div>

      {alert && alert.count > 0 && (
        <Link
          href={alert.href}
          className="mt-6 flex min-h-touch-admin items-center gap-3 rounded-input bg-black/25 px-4 py-3 text-white transition-colors duration-150 ease-out-pos hover:bg-black/35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          <CircleAlert size={20} aria-hidden className="shrink-0 text-sun" />
          <span className="min-w-0 flex-1 font-medium">{alert.label}</span>
          <ArrowRight size={18} aria-hidden className="shrink-0" />
        </Link>
      )}
    </section>
  );
}
