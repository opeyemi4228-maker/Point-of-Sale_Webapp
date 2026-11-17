"use client";

import { useMemo, useState } from "react";
import { ArrowRight, Lock, Minus, PackageMinus, PackagePlus, Plus } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { ADJUST_REASONS, WRITE_OFF_REASONS, planAdjustment, type AdjustDirection } from "@/lib/domain/inventory";
import { formatWhole, multiply } from "@/lib/domain/money";
import { addQty, formatQty, units, type Quantity } from "@/lib/domain/quantity";
import { documentRef } from "@/lib/hooks/use-inventory";
import { useLedgerStore } from "@/lib/stores/ledger";
import { cn } from "@/lib/utils/cn";
import type { Product } from "@/types/catalog";
import type { StockReason } from "@/types/enums";
import type { Staff } from "@/types/staff";

/**
 * Add or subtract stock by hand — SPEC §10.
 *
 * The one place a manager keys a movement that is not a delivery, a sale or a
 * transfer. It never sets a balance: it shows the balance now, the change, and
 * the balance after, then appends one movement with a reason and a name on it
 * (CLAUDE.md rule 3). Expired, damaged, theft and sample removals land in the
 * protected write-off register; they can be reversed, never edited.
 */

export type AdjustPreset = {
  direction: AdjustDirection;
  reason: StockReason;
  quantity?: number;
  note?: string;
  /** Links the movement to what it answers — a reversal points at the original. */
  ref?: string;
  /**
   * Locks direction, reason and quantity to the preset; used for reversals,
   * which must mirror the original exactly. The note stays open — a reversal
   * still has to say why.
   */
  locked?: boolean;
  title?: string;
};

export function AdjustStockSheet({
  product,
  branchId,
  branchCode,
  onHand,
  staff,
  preset,
  onClose,
  onDone,
}: {
  product: Product;
  branchId: string;
  branchCode: string;
  onHand: Quantity;
  staff: Staff;
  preset?: AdjustPreset;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const appendMovements = useLedgerStore((s) => s.appendMovements);

  const [direction, setDirection] = useState<AdjustDirection>(preset?.direction ?? "remove");
  const [reason, setReason] = useState<StockReason>(
    preset?.reason ?? ADJUST_REASONS[preset?.direction ?? "remove"][0].reason,
  );
  const [quantity, setQuantity] = useState(preset?.quantity ? String(preset.quantity) : "");
  const [note, setNote] = useState(preset?.note ?? "");
  const [submitted, setSubmitted] = useState(false);
  const locked = preset?.locked ?? false;


  function changeDirection(next: AdjustDirection) {
    setDirection(next);
    setReason(ADJUST_REASONS[next][0].reason);
  }

  const plan = useMemo(
    () =>
      planAdjustment({
        direction,
        reason,
        quantity: quantity === "" ? NaN : Number(quantity),
        soldBy: product.soldBy,
        onHand,
        note,
      }),
    [direction, reason, quantity, product.soldBy, onHand, note],
  );

  const after = plan.ok ? addQty(onHand, plan.delta) : null;
  const problem = (field: string) =>
    submitted && !plan.ok ? plan.problems.find((p) => p.field === field)?.message : undefined;
  const option = ADJUST_REASONS[direction].find((o) => o.reason === reason);
  const isWriteOff = direction === "remove" && WRITE_OFF_REASONS.includes(reason);

  function save(event: React.FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    if (!plan.ok) return;

    const at = new Date();
    const ref =
      preset?.ref ?? documentRef(isWriteOff ? "WO" : "ADJ", branchCode, at);
    appendMovements([
      {
        branchId,
        productId: product.id,
        delta: plan.delta,
        reason,
        at: at.toISOString(),
        staffId: staff.id,
        staffName: staff.fullName,
        ref,
        ...(note.trim() ? { note: note.trim() } : {}),
      },
    ]);

    const verb = direction === "add" ? "Added" : "Removed";
    onDone(
      `${verb} ${formatQty(units(Number(quantity)))} ${product.unit} of ${product.name} — ${option?.label.toLowerCase()}. On hand is now ${formatQty(after!)}.`,
    );
  }

  return (
    <Sheet
      title={preset?.title ?? "Adjust stock"}
      subtitle={
        <>
          {product.name}
          <span className="ml-2 font-mono text-label tracking-normal text-ink-40">{product.sku}</span>
        </>
      }
      onClose={onClose}
      onSubmit={save}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button type="submit" variant={direction === "remove" ? "danger" : "primary"} className="flex-2">
            {direction === "add" ? (
              <PackagePlus size={18} aria-hidden />
            ) : (
              <PackageMinus size={18} aria-hidden />
            )}
            {direction === "add" ? "Add to stock" : isWriteOff ? "Write off" : "Remove from stock"}
          </Button>
        </>
      }
    >
      {/* Direction — the first decision, and the one most costly to get wrong. */}
      {!locked && (
        <div role="radiogroup" aria-label="Direction" className="grid grid-cols-2 gap-2">
          <DirectionButton
            active={direction === "add"}
            onClick={() => changeDirection("add")}
            icon={Plus}
            label="Add stock"
          />
          <DirectionButton
            active={direction === "remove"}
            onClick={() => changeDirection("remove")}
            icon={Minus}
            label="Remove stock"
          />
        </div>
      )}

      <fieldset disabled={locked} className="flex flex-col gap-2">
        <legend className="mb-2 text-body font-semibold text-ink">Reason</legend>
        {ADJUST_REASONS[direction].map((o) => (
          <label
            key={`${direction}-${o.reason}`}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-input border px-3.5 py-3 transition-colors duration-150 ease-out-pos",
              reason === o.reason
                ? "border-market bg-market-tint"
                : "border-line bg-surface hover:border-ink-40",
              locked && reason !== o.reason && "hidden",
            )}
          >
            <input
              type="radio"
              name="reason"
              value={o.reason}
              checked={reason === o.reason}
              onChange={() => setReason(o.reason)}
              className="mt-1 size-4 accent-market"
            />
            <span className="min-w-0">
              <span className="block font-medium text-ink">{o.label}</span>
              <span className="block text-body text-ink-70">{o.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="adjust-qty" className="text-body font-semibold text-ink">
          Quantity to {direction === "add" ? "add" : "remove"} ({product.unit})
        </label>
        <input
          id="adjust-qty"
          type="number"
          inputMode="decimal"
          min={0}
          step={product.soldBy === "weight" ? 0.001 : 1}
          value={quantity}
          readOnly={locked}
          onChange={(event) => setQuantity(event.target.value)}
          aria-invalid={Boolean(problem("quantity")) || undefined}
          aria-describedby="adjust-qty-hint"
          autoFocus={!locked}
          className={cn(
            "min-h-14 w-full rounded-input border bg-surface px-4 font-numeric text-body-lg text-ink transition-colors duration-150 ease-out-pos focus:border-market focus:outline-2 focus:-outline-offset-2 focus:outline-market",
            problem("quantity") ? "border-halt" : "border-line hover:border-ink-40",
          )}
        />
        <p id="adjust-qty-hint" className={cn("text-body", problem("quantity") ? "text-halt" : "text-ink-40")}>
          {problem("quantity") ??
            (product.soldBy === "weight" ? "Up to three decimal places." : "Whole units only.")}
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="adjust-note" className="text-body font-semibold text-ink">
          Note
          {option?.needsNote ? (
            <>
              {" "}
              <span aria-hidden className="text-halt">*</span>
              <span className="sr-only">(required)</span>
            </>
          ) : (
            <span className="font-normal text-ink-40"> (optional)</span>
          )}
        </label>
        <textarea
          id="adjust-note"
          rows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder={isWriteOff ? "e.g. Batch from GRN-GWA-0723, binned" : "What happened"}
          aria-invalid={Boolean(problem("note")) || undefined}
          className={cn(
            "w-full rounded-input border bg-surface px-4 py-3 text-body text-ink placeholder:text-ink-40 transition-colors duration-150 ease-out-pos focus:border-market focus:outline-2 focus:-outline-offset-2 focus:outline-market",
            problem("note") ? "border-halt" : "border-line hover:border-ink-40",
          )}
        />
        {problem("note") && <p className="text-body text-halt">{problem("note")}</p>}
      </div>

      {/* Before → after. The manager confirms a result, not just an input. */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-panel border border-line bg-surface p-4">
        <Figure label="On hand now" value={formatQty(onHand)} unit={product.unit} />
        <ArrowRight size={20} aria-hidden className="text-ink-40" />
        <Figure
          label="After"
          value={after ? formatQty(after) : "—"}
          unit={product.unit}
          emphasis
        />
        {plan.ok && (
          <p className="col-span-3 border-t border-line pt-3 text-body text-ink-70">
            {direction === "add" ? "Adds" : "Writes off"}{" "}
            <span className="font-numeric font-semibold text-ink">
              {formatWhole(multiply(product.cost, Math.abs(plan.delta.milli) / 1000))}
            </span>{" "}
            at cost.
          </p>
        )}
      </div>

      {isWriteOff && (
        <Alert tone="info" title="Protected record">
          <span className="flex items-start gap-1.5">
            <Lock size={15} aria-hidden className="mt-1 shrink-0" />
            This goes into the write-off register with your name and the time. It
            cannot be edited or deleted — only reversed, and the reversal is kept
            beside it.
          </span>
        </Alert>
      )}
    </Sheet>
  );
}

function DirectionButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Plus;
  label: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "flex min-h-14 items-center justify-center gap-2 rounded-input border text-body-lg font-semibold",
        "transition-colors duration-150 ease-out-pos focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-market",
        active
          ? "border-ink bg-ink text-white"
          : "border-line bg-surface text-ink-70 hover:border-ink-40 hover:text-ink",
      )}
    >
      <Icon size={20} aria-hidden />
      {label}
    </button>
  );
}

function Figure({
  label,
  value,
  unit,
  emphasis,
}: {
  label: string;
  value: string;
  unit: string;
  emphasis?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="text-label uppercase text-ink-40">{label}</p>
      <p className={cn("font-numeric text-title", emphasis ? "font-bold text-ink" : "text-ink-70")}>
        {value}
        <span className="ml-1 text-body font-normal text-ink-40">{unit}</span>
      </p>
    </div>
  );
}
