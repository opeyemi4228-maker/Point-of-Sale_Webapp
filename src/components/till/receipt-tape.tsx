"use client";

import { useEffect, useRef } from "react";
import { Minus, Plus, Trash2 } from "lucide-react";
import { lineTotal, type BasketLine, type BasketTotals } from "@/lib/domain/basket";
import { format } from "@/lib/domain/money";
import { formatQty } from "@/lib/domain/quantity";
import { cn } from "@/lib/utils/cn";

/**
 * The live receipt tape — SPEC §15.1.
 *
 * What the customer would see if they were looking over the counter, and it is
 * built to be checked against a trolley: one line per product, the quantity and
 * the unit price both visible, and the line total on the right where the eye
 * can run down the column.
 *
 * Money is tabular here and only here it matters most — a column of totals that
 * does not align on the decimal cannot be scanned, and that is the column a
 * customer disputes.
 *
 * The line the last scan or tap changed is scrolled into view and marked. On a
 * long basket the tape is taller than its column, and a scan that merged into
 * a line forty rows up was otherwise invisible — the cashier saw nothing move
 * and scanned the tin again.
 */
export function ReceiptTape({
  lines,
  totals,
  touchedLineId,
  onIncrement,
  onDecrement,
  onRemove,
}: {
  lines: readonly BasketLine[];
  totals: BasketTotals;
  touchedLineId: string | null;
  onIncrement: (lineId: string) => void;
  onDecrement: (lineId: string) => void;
  onRemove: (lineId: string) => void;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  // Re-run on quantity as well as id: a second scan of the same tin touches
  // the same line, and it must still come back into view.
  const touched = lines.find((line) => line.id === touchedLineId);
  const touchedQuantity = touched?.quantity.milli;

  useEffect(() => {
    if (!touchedLineId) return;
    listRef.current
      ?.querySelector(`[data-line="${touchedLineId}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [touchedLineId, touchedQuantity]);

  if (lines.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-body-lg font-medium text-ink">Nothing on the tape yet</p>
        <p className="text-body text-ink-70">
          Scan a product, or pick one from the grid.
        </p>
      </div>
    );
  }

  return (
    <ol ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
      {lines.map((line) => (
        <li
          key={line.id}
          data-line={line.id}
          aria-current={line.id === touchedLineId ? "true" : undefined}
          className={cn(
            "border-b border-l-4 border-b-line px-4 py-3.5 transition-colors duration-150 ease-out-pos",
            line.id === touchedLineId
              ? "border-l-market bg-market-tint"
              : "border-l-transparent",
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <p className="min-w-0 flex-1 font-medium text-ink">{line.product.name}</p>
            <p className="font-numeric shrink-0 font-semibold text-ink tabular-nums">
              {format(lineTotal(line))}
            </p>
          </div>

          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="font-numeric min-w-0 truncate text-body text-ink-70">
              {formatQty(line.quantity)}
              {line.product.soldBy === "weight" ? ` ${line.product.unit}` : ""} ×{" "}
              {format(line.unitPrice)}
            </p>

            <div className="flex shrink-0 items-center gap-1">
              {/* Weighed lines have no stepper: "one more kilo" is not a thing a
                  scale says. Change the weight by removing and re-weighing. */}
              {line.product.soldBy === "unit" && (
                <>
                  <StepButton
                    label={`Remove one ${line.product.name}`}
                    onClick={() => onDecrement(line.id)}
                  >
                    <Minus size={20} />
                  </StepButton>
                  <StepButton
                    label={`Add one ${line.product.name}`}
                    onClick={() => onIncrement(line.id)}
                  >
                    <Plus size={20} />
                  </StepButton>
                </>
              )}
              <StepButton
                label={`Remove ${line.product.name} from the sale`}
                onClick={() => onRemove(line.id)}
                tone="halt"
              >
                <Trash2 size={19} />
              </StepButton>
            </div>
          </div>
        </li>
      ))}

      <li className="px-4 py-3 text-body text-ink-40">
        {totals.lineCount} {totals.lineCount === 1 ? "line" : "lines"} ·{" "}
        {totals.itemCount} {totals.itemCount === 1 ? "item" : "items"}
      </li>
    </ol>
  );
}

/**
 * 44px, not the till's usual 56px. These sit three-to-a-row inside a 400px
 * tape beside the line they act on; at 56px they would push the price off the
 * row. They are still comfortably above the 44px floor and are never the only
 * way to do anything — a mis-scan can also be cleared with Void sale.
 */
function StepButton({
  label,
  onClick,
  tone = "neutral",
  children,
}: {
  label: string;
  onClick: () => void;
  tone?: "neutral" | "halt";
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "grid size-11 place-items-center rounded-input border border-line bg-surface",
        "transition-colors duration-150 ease-out-pos",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-market",
        tone === "halt"
          ? "text-ink-40 hover:border-halt hover:bg-halt-tint hover:text-halt"
          : "text-ink-70 hover:border-market hover:bg-market-tint hover:text-market",
      )}
    >
      {children}
    </button>
  );
}
