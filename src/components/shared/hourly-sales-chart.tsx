"use client";

import { useState } from "react";
import type { Money } from "@/lib/domain/money";
import { formatCompact, format, toNaira } from "@/lib/domain/money";
import { cn } from "@/lib/utils/cn";

export type HourlyBucket = {
  /** 24-hour clock, e.g. 8 for the 08:00–08:59 bucket. */
  hour: number;
  total: Money;
  transactions: number;
};

const hourLabel = (hour: number) => `${String(hour).padStart(2, "0")}:00`;

/**
 * Sales by hour — SPEC §15.2.
 *
 * One series, so there is no legend: the panel title already says what is
 * plotted, and a one-swatch legend box would just restate it. The peak hour is
 * labelled directly; every other value is carried by the axis, the hover
 * tooltip and the table underneath, which is available to screen readers and
 * is the relief for anyone who cannot use the hover layer.
 */
export function HourlySalesChart({ buckets }: { buckets: readonly HourlyBucket[] }) {
  return (
    <SalesColumnChart
      caption="Sales by hour"
      keyHeading="Hour"
      buckets={buckets.map((b) => ({
        key: String(b.hour),
        label: hourLabel(b.hour),
        tick: String(b.hour).padStart(2, "0"),
        total: b.total,
        transactions: b.transactions,
      }))}
    />
  );
}

export type ColumnBucket = {
  key: string;
  /** Full label for the tooltip and the table, e.g. `08:00` or `17 Nov`. */
  label: string;
  /** Short axis tick. */
  tick: string;
  total: Money;
  transactions: number;
};

/**
 * Takings as columns over any run of buckets — hours of a day, days of a
 * month. One series, one axis; the rules are the ones described above.
 */
export function SalesColumnChart({
  buckets,
  caption,
  keyHeading,
  countNoun = "transactions",
}: {
  buckets: readonly ColumnBucket[];
  caption: string;
  keyHeading: string;
  /** What `transactions` counts, for the tooltip and the table. */
  countNoun?: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  // Thin the axis labels so they never collide, however many columns there are.
  const tickEvery = Math.max(1, Math.ceil(buckets.length / 12));

  const peakNaira = Math.max(...buckets.map((b) => toNaira(b.total)), 0);
  const ceiling = niceCeiling(peakNaira);
  const peakIndex = buckets.findIndex((b) => toNaira(b.total) === peakNaira);

  const ticks = [1, 0.75, 0.5, 0.25, 0].map((fraction) => ({
    fraction,
    value: ceiling * fraction,
  }));

  return (
    <figure className="m-0">
      <div className="flex gap-3 px-5 pt-5">
        {/* Y axis — clean round numbers, tabular so they align on the decimal */}
        <div
          className="font-numeric relative hidden w-14 shrink-0 text-label text-ink-40 sm:block"
          style={{ height: 200 }}
          aria-hidden
        >
          {ticks.map(({ fraction, value }) => (
            <span
              key={fraction}
              className="absolute right-0 -translate-y-1/2 tabular-nums"
              style={{ top: `${(1 - fraction) * 100}%` }}
            >
              {value === 0 ? "0" : formatCompact({ kobo: Math.round(value * 100) })}
            </span>
          ))}
        </div>

        <div className="relative min-w-0 flex-1">
          {/* Gridlines: hairline, solid, one step off the surface */}
          <div className="absolute inset-0" style={{ height: 200 }} aria-hidden>
            {ticks.map(({ fraction }) => (
              <div
                key={fraction}
                className="absolute inset-x-0 border-t border-line"
                style={{ top: `${(1 - fraction) * 100}%` }}
              />
            ))}
          </div>

          {/* Columns */}
          <div className="relative flex items-end gap-0.5" style={{ height: 200 }}>
            {buckets.map((bucket, index) => {
              const value = toNaira(bucket.total);
              const heightPct = ceiling === 0 ? 0 : (value / ceiling) * 100;
              const isActive = active === index;

              return (
                <button
                  key={bucket.key}
                  type="button"
                  onMouseEnter={() => setActive(index)}
                  onMouseLeave={() => setActive(null)}
                  onFocus={() => setActive(index)}
                  onBlur={() => setActive(null)}
                  aria-label={`${bucket.label}, ${format(bucket.total)} across ${bucket.transactions} ${countNoun}`}
                  className="group relative flex h-full flex-1 cursor-default flex-col justify-end rounded-t-[4px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-market"
                >
                  {/* Direct label on the peak only — never a number on every column */}
                  {index === peakIndex && value > 0 && (
                    <span
                      className="font-numeric absolute inset-x-0 text-center text-label text-ink-70"
                      style={{ bottom: `calc(${heightPct}% + 6px)` }}
                    >
                      {formatCompact(bucket.total)}
                    </span>
                  )}

                  <span
                    className={cn(
                      "mx-auto w-full max-w-6 rounded-t-[4px] transition-colors duration-150 ease-out-pos",
                      isActive ? "bg-market-dark" : "bg-market",
                    )}
                    style={{ height: `${heightPct}%` }}
                  />

                  {isActive && (
                    <div
                      role="tooltip"
                      className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 w-max -translate-x-1/2 rounded-input border border-line bg-surface px-3 py-2 text-left shadow-raised"
                    >
                      <p className="font-numeric text-label text-ink-40">
                        {bucket.label}
                      </p>
                      <p className="font-numeric font-semibold text-ink">
                        {format(bucket.total)}
                      </p>
                      <p className="text-label text-ink-40">
                        {bucket.transactions} {countNoun}
                      </p>
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* X axis */}
          <div className="mt-2 flex gap-0.5" aria-hidden>
            {buckets.map((bucket, index) => (
              <span
                key={bucket.key}
                className={cn(
                  "font-numeric flex-1 text-center text-label",
                  active === index ? "text-ink" : "text-ink-40",
                )}
              >
                {index % tickEvery === 0 ? bucket.tick : ""}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* The table view — the relief the hover layer cannot give */}
      <figcaption className="sr-only">
        <table>
          <caption>{caption}</caption>
          <thead>
            <tr>
              <th scope="col">{keyHeading}</th>
              <th scope="col">Sales</th>
              <th scope="col" className="capitalize">{countNoun}</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((bucket) => (
              <tr key={bucket.key}>
                <th scope="row">{bucket.label}</th>
                <td>{format(bucket.total)}</td>
                <td>{bucket.transactions}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </figcaption>
    </figure>
  );
}

/** Round the axis top up to a clean 1/2/5 × power of ten, so ticks read well. */
function niceCeiling(peak: number): number {
  if (peak <= 0) return 0;
  const magnitude = 10 ** Math.floor(Math.log10(peak));
  const normalised = peak / magnitude;
  const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
  return step * magnitude;
}
