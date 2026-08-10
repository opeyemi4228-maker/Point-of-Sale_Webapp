import { cn } from "@/lib/utils/cn";

/**
 * The scrolling body of a workspace screen.
 *
 * Two jobs, both of which every screen was otherwise repeating by hand:
 *
 * 1. **A measure.** Panels stretched edge to edge look broken on a 27" monitor —
 *    a four-tile row spreads until the label and its number are a hand's width
 *    apart, and a table row becomes impossible to track across. `max-w-7xl`
 *    caps it and centres what is left.
 * 2. **Padding that shrinks.** 20px of gutter on a 390px phone is 10% of the
 *    screen. It steps down to 16px below `sm`.
 *
 * `min-h-0` matters inside the till's fixed-height shell: without it a flex
 * child refuses to shrink below its content and the panel scrolls the page
 * instead of itself.
 */
export function PageBody({
  children,
  className,
  /** Forms and wizards read better narrow — they are a column, not a dashboard. */
  width = "wide",
}: {
  children: React.ReactNode;
  className?: string;
  width?: "wide" | "narrow";
}) {
  return (
    <main className="min-h-0 flex-1 overflow-y-auto">
      <div
        className={cn(
          "mx-auto flex w-full flex-col gap-4 p-4 sm:gap-5 sm:p-5",
          width === "narrow" ? "max-w-3xl" : "max-w-7xl",
          className,
        )}
      >
        {children}
      </div>
    </main>
  );
}
