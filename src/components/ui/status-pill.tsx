import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleSlash,
  Clock,
  TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";

/**
 * A state, said three ways at once — SPEC §14.
 *
 * Colour is never the only signal: every tone ships with its own icon and its
 * own word. Around one in twelve Nigerian men has some form of colour-vision
 * deficiency, and a cashier reading "approved" as "declined" costs real money.
 */
export type StatusTone =
  | "done" // settled, approved, received
  | "live" // in flight, in transit, counting
  | "waiting" // pending a decision
  | "warning" // needs attention but not broken
  | "stopped" // rejected, cancelled, suspended
  | "idle"; // draft, not started

const TONES: Record<StatusTone, { icon: typeof CircleCheck; className: string }> = {
  done: { icon: CircleCheck, className: "border-market/30 bg-market-tint text-ink" },
  live: { icon: Clock, className: "border-info/30 bg-surface text-ink" },
  waiting: { icon: Clock, className: "border-signal/40 bg-sun text-ink" },
  warning: { icon: TriangleAlert, className: "border-signal/40 bg-sun text-ink" },
  stopped: { icon: CircleSlash, className: "border-halt/30 bg-halt-tint text-ink" },
  idle: { icon: CircleDashed, className: "border-line bg-paper text-ink-70" },
};

export function StatusPill({
  tone,
  children,
  className,
}: {
  tone: StatusTone;
  children: React.ReactNode;
  className?: string;
}) {
  const { icon: Icon, className: toneClass } = TONES[tone];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-1 text-label font-semibold whitespace-nowrap",
        toneClass,
        className,
      )}
    >
      <Icon size={14} aria-hidden className="shrink-0" />
      {children}
    </span>
  );
}

/** For a count that means trouble above zero, e.g. exceptions on a branch row. */
export function CountPill({
  count,
  serious,
  label,
}: {
  count: number;
  serious?: boolean;
  label: string;
}) {
  if (count === 0) {
    return <span className="text-ink-40">None</span>;
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-1 font-semibold",
        serious ? "border-halt/30 bg-halt-tint text-ink" : "border-line bg-paper text-ink-70",
      )}
    >
      {serious && <CircleAlert size={14} aria-hidden className="shrink-0 text-halt" />}
      {count}
      <span className="sr-only"> {label}</span>
    </span>
  );
}
