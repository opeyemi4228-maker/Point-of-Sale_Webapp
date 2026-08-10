"use client";

import { useState } from "react";
import { Scale, X } from "lucide-react";
import { format, multiply } from "@/lib/domain/money";
import type { Product } from "@/types/catalog";
import { cn } from "@/lib/utils/cn";

/**
 * Weight entry for loose goods — SPEC §9.4.
 *
 * Swiftgrocers' scales are not wired to the till, so the cashier reads the
 * weight off the scale and keys it. That is the honest workflow, and pretending
 * otherwise would mean a number nobody can check.
 *
 * The running line total updates as the weight is keyed, which is the only
 * defence against a slipped decimal: 12.5 kg of tomatoes is an obviously wrong
 * number, but ₦27,500 is obviously wrong *faster*.
 */
export function WeightPrompt({
  product,
  onCancel,
  onConfirm,
}: {
  product: Product;
  onCancel: () => void;
  onConfirm: (kilos: number) => void;
}) {
  const [entry, setEntry] = useState("");

  const kilos = Number(entry || 0);
  const valid = kilos > 0 && Number.isFinite(kilos);
  const lineTotal = multiply(product.price, kilos);

  const press = (key: string) =>
    setEntry((current) => {
      if (key === "." && current.includes(".")) return current;
      const next = current + key;
      // Three decimals is what the type carries and what a scale reports.
      const [, decimals] = next.split(".");
      if (decimals && decimals.length > 3) return current;
      return next.slice(0, 8);
    });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Weigh ${product.name}`}
      className="fixed inset-0 z-50 grid place-items-center bg-ink/50 p-4"
    >
      <div className="w-full max-w-108 overflow-hidden rounded-panel bg-surface shadow-raised">
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-label uppercase text-market">
              <Scale size={16} aria-hidden />
              Weigh this item
            </p>
            <h2 className="mt-1 font-display text-title font-bold text-ink">
              {product.name}
            </h2>
            <p className="font-numeric text-body text-ink-70">
              {format(product.price)} per {product.unit}
            </p>
          </div>

          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel"
            className="grid size-touch-till shrink-0 place-items-center rounded-input text-ink-70 transition-colors duration-150 ease-out-pos hover:bg-halt-tint hover:text-halt focus-visible:outline-2 focus-visible:outline-market"
          >
            <X size={24} />
          </button>
        </header>

        <div className="p-5">
          <div className="rounded-panel border border-line bg-paper px-5 py-4 text-center">
            <p className="font-numeric font-display text-display-lg leading-none font-black text-ink">
              {entry === "" ? "0" : entry}
              <span className="ml-2 text-title font-bold text-ink-40">
                {product.unit}
              </span>
            </p>
            <p className="font-numeric mt-2 text-body-lg text-ink-70">
              {valid ? format(lineTotal) : "Key the weight from the scale"}
            </p>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-3">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0"].map((key) => (
              <Key key={key} onClick={() => press(key)}>
                {key}
              </Key>
            ))}
            <Key onClick={() => setEntry((c) => c.slice(0, -1))} label="Delete">
              ←
            </Key>
          </div>

          <div className="mt-5 flex gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="min-h-touch-till flex-1 rounded-input border border-line bg-surface px-5 text-body-lg font-medium text-ink transition-colors duration-150 ease-out-pos hover:bg-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-market"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!valid}
              onClick={() => onConfirm(kilos)}
              className="min-h-touch-till flex-2 rounded-input bg-market px-5 text-body-lg font-semibold text-white shadow-raised transition-colors duration-150 ease-out-pos hover:bg-market-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-market disabled:cursor-not-allowed disabled:opacity-50"
            >
              Add to sale
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Key({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "grid min-h-14 place-items-center rounded-input border border-line bg-surface",
        "font-display text-title font-bold text-ink",
        "transition-colors duration-150 ease-out-pos",
        "hover:border-market hover:bg-market-tint active:bg-market-tint",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-market",
      )}
    >
      {children}
    </button>
  );
}
