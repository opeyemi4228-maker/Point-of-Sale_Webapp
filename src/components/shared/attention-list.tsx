import Link from "next/link";
import { ChevronRight, CircleAlert, Info, TriangleAlert } from "lucide-react";
import type { AttentionItem, Severity } from "@/types/dashboard";
import { cn } from "@/lib/utils/cn";

const SEVERITY: Record<
  Severity,
  { icon: typeof Info; iconClass: string; chip: string; word: string }
> = {
  serious: {
    icon: CircleAlert,
    iconClass: "text-halt",
    chip: "bg-halt-tint border-halt/30",
    word: "Serious",
  },
  warning: {
    icon: TriangleAlert,
    // Yellow is far too light to be a lone thin mark, so it fills the chip and
    // the icon goes black on top — 13.3:1, and the word carries the state.
    iconClass: "text-ink",
    chip: "bg-sun border-signal/40",
    word: "Attention",
  },
  info: {
    icon: Info,
    iconClass: "text-info",
    chip: "bg-surface border-line",
    word: "Note",
  },
};

/**
 * "Needs you now" — SPEC §15.2.
 *
 * A manager should open the app and immediately see what needs a decision, not
 * a wall of charts. Serious items sort above warnings, and every row ends in the
 * one action that clears it.
 */
export function AttentionList({ items }: { items: readonly AttentionItem[] }) {
  if (items.length === 0) {
    return (
      <p className="px-5 py-8 text-center text-body-lg text-ink-70">
        Nothing needs a decision right now.
      </p>
    );
  }

  const ordered = [...items].sort(
    (a, b) => rank(a.severity) - rank(b.severity),
  );

  return (
    <ul className="divide-y divide-line">
      {ordered.map((item) => {
        const { icon: Icon, iconClass, chip, word } = SEVERITY[item.severity];

        return (
          <li key={item.id}>
            <Link
              href={item.href}
              className={cn(
                "flex min-h-touch-admin items-center gap-4 px-5 py-3.5",
                "transition-colors duration-150 ease-out-pos hover:bg-paper",
                "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-market",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "grid size-9 shrink-0 place-items-center rounded-input border",
                  chip,
                )}
              >
                <Icon size={18} className={iconClass} />
              </span>

              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-ink">
                  <span className="sr-only">{word}: </span>
                  {item.title}
                </span>
                <span className="block truncate text-body text-ink-70">
                  {item.detail}
                </span>
              </span>

              <span className="flex shrink-0 items-center gap-1 font-medium text-market">
                <span className="hidden sm:inline">{item.actionLabel}</span>
                <ChevronRight size={18} aria-hidden />
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

const rank = (severity: Severity) =>
  severity === "serious" ? 0 : severity === "warning" ? 1 : 2;
