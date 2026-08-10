"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Horizontal scroll container for a wide table.
 *
 * `relative` is not decoration — it is the fix for a real bug. Tailwind's
 * `sr-only` is `position: absolute`, so without a positioned ancestor its
 * containing block is the document itself. A screen-reader-only span inside an
 * 800px-wide table then escapes this container's clipping, parks itself at
 * x ≈ 800, and the whole page scrolls sideways on a phone while the visible
 * layout looks perfectly fine. Establishing a containing block here contains
 * every absolutely-positioned descendant, sr-only spans included.
 *
 * It also carries the affordance. A table clipped at the right edge with no
 * indication it continues is the most common way a phone user simply never
 * finds the last three columns — so when there is more to see, the edge fades
 * and a hint says so, and both disappear the moment the reader reaches the end.
 *
 * The container is focusable when it scrolls, because a keyboard user needs to
 * be able to reach the overflow too — a scroll region that only a mouse can
 * move is not reachable at all without it.
 */
export function TableScroller({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [atEnd, setAtEnd] = useState(false);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const slack = el.scrollWidth - el.clientWidth;
    setOverflowing(slack > 1);
    setAtEnd(slack <= 1 || el.scrollLeft >= slack - 1);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    // The table itself can change width without the container doing so.
    if (el.firstElementChild) observer.observe(el.firstElementChild);

    return () => observer.disconnect();
  }, [measure]);

  const showHint = overflowing && !atEnd;

  return (
    <div className={cn("relative", className)}>
      <div
        ref={ref}
        onScroll={measure}
        tabIndex={overflowing ? 0 : undefined}
        role={overflowing ? "region" : undefined}
        aria-label={overflowing ? "Table, scrolls sideways" : undefined}
        className="overflow-x-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-market"
      >
        {children}
      </div>

      {/* The fade sits over the table's right edge, never over the page. */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 right-0 w-12 bg-linear-to-l from-surface to-transparent",
          "transition-opacity duration-150 ease-out-pos",
          showHint ? "opacity-100" : "opacity-0",
        )}
      />

      {showHint && (
        <p className="border-t border-line px-5 py-2 text-label text-ink-40 sm:hidden">
          Scroll sideways for more columns
        </p>
      )}
    </div>
  );
}
