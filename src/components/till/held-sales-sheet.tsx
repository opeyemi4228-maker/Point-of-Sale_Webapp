"use client";

import { useEffect } from "react";
import { Clock, Gift, PauseCircle, Play, X } from "lucide-react";
import { format } from "@/lib/domain/money";
import { shortTime } from "@/lib/utils/format-date";
import type { HeldSale } from "@/lib/stores/basket";

/**
 * Held sales — SPEC §15.1.
 *
 * The customer who has gone back for the bread, or is waiting on a transfer to
 * clear, should not hold up the queue behind them. Their basket goes on the
 * shelf, the next customer is served, and the basket comes back whole —
 * lines, prices as quoted, and loyalty card.
 *
 * Each held sale shows what a cashier would recognise it by from across the
 * counter: the time, the size, the total and, when there is one, the name on
 * the card. Never a sale number — nobody remembers those.
 */
export function HeldSalesSheet({
  held,
  hasOpenSale,
  onResume,
  onClose,
}: {
  held: readonly HeldSale[];
  /** An open sale swaps onto the shelf on resume, and the button says so. */
  hasOpenSale: boolean;
  onResume: (id: string) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Held sales"
      className="fixed inset-0 z-50 flex items-stretch justify-end bg-ink/50"
    >
      <div className="flex w-full max-w-124 flex-col overflow-y-auto bg-paper shadow-raised">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-line bg-surface px-5 py-4">
          <h2 className="flex items-center gap-2 font-display text-title font-bold text-ink">
            <PauseCircle size={24} aria-hidden className="text-signal" />
            Held sales
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close held sales"
            className="grid size-touch-till place-items-center rounded-input text-ink-70 transition-colors duration-150 ease-out-pos hover:bg-paper focus-visible:outline-2 focus-visible:outline-market"
          >
            <X size={26} />
          </button>
        </header>

        {held.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="text-body-lg font-medium text-ink">No sales on hold</p>
            <p className="text-body text-ink-70">
              Hold a sale to serve the next customer while this one waits.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3 p-5">
            {/* Oldest first: the customer who has waited longest is served first. */}
            {held.map((sale) => (
              <li key={sale.id} className="rounded-panel border border-line bg-surface p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-numeric font-display text-title font-bold text-ink">
                      {format(sale.total)}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-body text-ink-70">
                      <span className="flex items-center gap-1.5">
                        <Clock size={16} aria-hidden />
                        Held {shortTime(sale.heldAt)}
                      </span>
                      <span>
                        {sale.itemCount} {sale.itemCount === 1 ? "item" : "items"}
                      </span>
                      <span>by {sale.heldBy}</span>
                    </p>
                    {sale.customer && (
                      <p className="mt-1 flex items-center gap-1.5 text-body font-medium text-market">
                        <Gift size={16} aria-hidden />
                        {sale.customer.customer.fullName}
                      </p>
                    )}
                    <p className="mt-2 line-clamp-2 text-body text-ink-40">
                      {sale.lines.map((line) => line.product.name).join(", ")}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onResume(sale.id)}
                  className="mt-3 flex min-h-touch-till w-full items-center justify-center gap-2 rounded-input bg-market px-4 text-body-lg font-semibold text-white shadow-raised transition-colors duration-150 ease-out-pos hover:bg-market-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-market"
                >
                  <Play size={20} aria-hidden />
                  {hasOpenSale ? "Swap in — hold the current sale" : "Resume this sale"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
