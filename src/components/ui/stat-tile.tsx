import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export type Delta = {
  /** Signed percentage points, e.g. -8.2. */
  percent: number;
  /** What it is measured against, e.g. "last week". */
  versus: string;
  /** Whether a rise is good news. Margin: yes. Shrinkage: no. */
  riseIsGood?: boolean;
};

/**
 * A headline figure — SPEC §15.2/§15.3.
 *
 * The value uses proportional figures, not tabular: `tabular-nums` gives every
 * digit the width of a zero, which looks loose at display sizes. Tabular is for
 * columns that must align vertically, which is the tables, not this.
 *
 * Direction is never colour alone — the arrow icon and the signed number both
 * carry it, so it survives a greyscale screen and colour-vision deficiency.
 */
export function StatTile({
  label,
  value,
  delta,
  hint,
  icon: Icon,
  className,
}: {
  label: string;
  value: string;
  delta?: Delta;
  hint?: string;
  /** Optional glyph for the tile. Decoration and recognition, never the meaning. */
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  className?: string;
}) {
  return (
    <div className={cn("px-5 py-4", className)}>
      <div className="flex items-center gap-2.5">
        {Icon && (
          <span
            aria-hidden
            className="grid size-8 shrink-0 place-items-center rounded-input bg-market-tint text-market"
          >
            <Icon size={17} />
          </span>
        )}
        <p className="text-label uppercase text-ink-40">{label}</p>
      </div>

      {/* The scale token, not a one-off pixel value: this figure and the hero
          have to step against each other, and they cannot if one of them is
          hardcoded. */}
      <p className="mt-2 font-display text-display-md text-ink">{value}</p>
      {delta && <DeltaChip {...delta} />}
      {hint && !delta && <p className="mt-1 text-body text-ink-40">{hint}</p>}
    </div>
  );
}

export function DeltaChip({ percent, versus, riseIsGood = true }: Delta) {
  const flat = Math.abs(percent) < 0.05;
  const good = flat ? null : percent > 0 === riseIsGood;
  const Icon = flat ? Minus : percent > 0 ? TrendingUp : TrendingDown;

  return (
    <p className="mt-1.5 flex items-center gap-1.5 text-body">
      <Icon
        size={16}
        aria-hidden
        className={cn(
          "shrink-0",
          good === null ? "text-ink-40" : good ? "text-market" : "text-halt",
        )}
      />
      <span
        className={cn(
          "font-numeric font-medium",
          good === null ? "text-ink-40" : good ? "text-market" : "text-halt",
        )}
      >
        {percent > 0 ? "+" : ""}
        {percent.toFixed(1)}%
      </span>
      <span className="text-ink-40">vs {versus}</span>
    </p>
  );
}
