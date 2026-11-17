"use client";

import { useMemo, useState } from "react";
import { CalendarRange, Store, Tags } from "lucide-react";
import {
  ALL_BRANCHES,
  RANGE_PRESETS,
  type DayRangeControl,
  type InventoryScope,
} from "@/lib/hooks/use-inventory";
import { cn } from "@/lib/utils/cn";
import type { Product } from "@/types/catalog";

/**
 * The filter row along the top of every inventory screen: which branch (HQ
 * only), which window of days, and — where a screen lists products — which
 * category and product.
 *
 * A manager sees their branch named, not a picker with one option — a control
 * that can only ever say one thing is a label pretending to be a choice.
 */
export function ScopeControls({
  scope,
  allowAll,
  dates,
  children,
}: {
  scope?: InventoryScope;
  allowAll: boolean;
  dates?: DayRangeControl;
  /** Screen-specific filters, placed after the shared ones. */
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {scope &&
        (scope.canPick ? (
          <label className="flex items-center gap-2">
            <Store size={18} aria-hidden className="text-ink-40" />
            <span className="sr-only">Branch</span>
            <select
              value={scope.branchId}
              onChange={(event) => scope.setBranchId(event.target.value)}
              className={selectClass}
            >
              {allowAll && <option value={ALL_BRANCHES}>All branches</option>}
              {scope.branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          scope.branch && (
            <span className="inline-flex min-h-touch-admin items-center gap-2 rounded-input border border-line bg-paper px-3 text-body font-medium text-ink-70">
              <Store size={18} aria-hidden className="text-ink-40" />
              {scope.branch.name}
            </span>
          )
        ))}

      {dates && <DateRangeControls dates={dates} />}

      {children}
    </div>
  );
}

function DateRangeControls({ dates }: { dates: DayRangeControl }) {
  const { range, setPreset, setCustom, today } = dates;
  const isCustom = range.preset === "custom";

  return (
    <div role="group" aria-label="Date range" className="flex flex-wrap items-center gap-1.5">
      {RANGE_PRESETS.map((option) => (
        <Chip key={option.value} active={range.preset === option.value} onClick={() => setPreset(option.value)}>
          {option.label}
        </Chip>
      ))}
      <Chip active={isCustom} onClick={() => setCustom(range.fromDay, range.toDay)}>
        <CalendarRange size={16} aria-hidden />
        Custom
      </Chip>
      {isCustom && (
        <span className="flex flex-wrap items-center gap-1.5">
          <label className="sr-only" htmlFor="range-from">From</label>
          <input
            id="range-from"
            type="date"
            max={today}
            value={range.fromDay}
            onChange={(event) => event.target.value && setCustom(event.target.value, range.toDay)}
            className={cn(selectClass, "pr-3 font-numeric")}
          />
          <span aria-hidden className="text-ink-40">to</span>
          <label className="sr-only" htmlFor="range-to">To</label>
          <input
            id="range-to"
            type="date"
            max={today}
            value={range.toDay}
            onChange={(event) => event.target.value && setCustom(range.fromDay, event.target.value)}
            className={cn(selectClass, "pr-3 font-numeric")}
          />
        </span>
      )}
    </div>
  );
}

/* ── Catalog filter ───────────────────────────────────────────────────────── */

export type CatalogFilterValue = { categoryId: string; productId: string };
export const ANY_PRODUCT: CatalogFilterValue = { categoryId: "all", productId: "all" };

export const matchesCatalog = (product: Pick<Product, "id" | "categoryId">, f: CatalogFilterValue) =>
  (f.productId === "all" || product.id === f.productId) &&
  (f.categoryId === "all" || product.categoryId === f.categoryId);

export function useCatalogFilter() {
  return useState<CatalogFilterValue>(ANY_PRODUCT);
}

/** Category, then a product within it. Choosing a product narrows to one line. */
export function CatalogFilter({
  products,
  value,
  onChange,
}: {
  products: readonly Product[];
  value: CatalogFilterValue;
  onChange: (value: CatalogFilterValue) => void;
}) {
  const categories = useMemo(() => {
    const seen = new Map<string, string>();
    for (const p of products) seen.set(p.categoryId, p.categoryName);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [products]);

  const inCategory = useMemo(
    () =>
      products
        .filter((p) => value.categoryId === "all" || p.categoryId === value.categoryId)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [products, value.categoryId],
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Tags size={18} aria-hidden className="text-ink-40" />
      <label className="sr-only" htmlFor="filter-category">Category</label>
      <select
        id="filter-category"
        value={value.categoryId}
        onChange={(event) => onChange({ categoryId: event.target.value, productId: "all" })}
        className={selectClass}
      >
        <option value="all">All categories</option>
        {categories.map(([id, name]) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
      </select>
      <label className="sr-only" htmlFor="filter-product">Product</label>
      <select
        id="filter-product"
        value={value.productId}
        onChange={(event) => onChange({ ...value, productId: event.target.value })}
        className={cn(selectClass, "max-w-72")}
      >
        <option value="all">All products</option>
        {inCategory.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
            {p.delistedAt ? " (delisted)" : ""}
          </option>
        ))}
      </select>
      {(value.categoryId !== "all" || value.productId !== "all") && (
        <button
          type="button"
          onClick={() => onChange(ANY_PRODUCT)}
          className="min-h-touch-admin rounded-input px-2 font-medium text-market hover:bg-market-tint focus-visible:outline-2 focus-visible:outline-market"
        >
          Clear
        </button>
      )}
    </div>
  );
}

const selectClass =
  "min-h-touch-admin rounded-input border border-line bg-surface px-3 pr-8 text-body font-medium text-ink transition-colors duration-150 ease-out-pos hover:border-ink-40 focus:outline-2 focus:outline-offset-0 focus:outline-market";

/* ── Pieces ───────────────────────────────────────────────────────────────── */

export function Chip({
  active,
  onClick,
  children,
  count,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex min-h-touch-admin shrink-0 items-center gap-2 rounded-pill border px-4 text-body font-medium",
        "transition-colors duration-150 ease-out-pos",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-market",
        active
          ? "border-market bg-market text-white"
          : "border-line bg-surface text-ink-70 hover:border-market hover:text-market",
      )}
    >
      {children}
      {count !== undefined && (
        <span
          className={cn(
            "rounded-pill px-1.5 font-numeric text-label tracking-normal",
            active ? "bg-white/20 text-white" : "bg-paper text-ink-70",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

/** Shown in place of a write action when HQ is looking at the whole chain. */
export function PickBranchFirst({ what }: { what: string }) {
  return (
    <p className="flex items-start gap-2 px-5 py-6 text-body text-ink-70">
      <Store size={18} aria-hidden className="mt-0.5 shrink-0 text-ink-40" />
      Choose a branch at the top of the screen to {what}. Stock always moves in a
      branch, never in the chain as a whole.
    </p>
  );
}
