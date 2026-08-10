"use client";

import { Scale } from "lucide-react";
import { ProductImage } from "@/components/shared/product-image";
import { format } from "@/lib/domain/money";
import type { Product } from "@/types/catalog";
import type { Category } from "@/types/catalog";
import { cn } from "@/lib/utils/cn";

/**
 * The product grid — SPEC §15.1.
 *
 * The fallback for everything without a scannable code: loose produce, a label
 * that will not read, a customer changing their mind at the counter. Tiles are
 * large because they are hit with a thumb at speed, and they carry the price,
 * because the question a cashier is answering is usually "how much is this?".
 *
 * A tile shows a photograph only if there is a real one. Most of the catalog
 * has none today, and those tiles lead with the name at a larger size instead —
 * see `ProductImage` for why a drawn stand-in was worse than nothing.
 */
export function ProductGrid({
  products,
  categories,
  activeCategory,
  onCategory,
  onPick,
}: {
  products: readonly Product[];
  categories: readonly Category[];
  activeCategory: string | null;
  onCategory: (categoryId: string | null) => void;
  onPick: (product: Product) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Category filter. Horizontally scrollable rather than wrapped: a second
          row of chips would come out of the grid's height. */}
      <div className="shrink-0 overflow-x-auto border-b border-line px-4 py-3">
        <div className="flex w-max gap-2">
          <CategoryChip
            label="All"
            active={activeCategory === null}
            onClick={() => onCategory(null)}
          />
          {categories.map((category) => (
            <CategoryChip
              key={category.id}
              label={category.name}
              active={activeCategory === category.id}
              onClick={() => onCategory(category.id)}
            />
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {products.length === 0 ? (
          <p className="py-12 text-center text-body-lg text-ink-70">
            Nothing matches. Clear the search, or scan the product.
          </p>
        ) : (
          // `items-stretch` plus `h-full` on the button: every tile in a row is
          // the same height, so the prices sit on one line across the grid and
          // the eye can run down the column.
          <ul className="grid grid-cols-2 items-stretch gap-3 sm:grid-cols-3 2xl:grid-cols-4">
            {products.map((product) => (
              <li key={product.id}>
                <button
                  type="button"
                  onClick={() => onPick(product)}
                  className={cn(
                    "flex h-full w-full flex-col gap-2.5 rounded-card border border-line bg-surface p-3.5 text-left",
                    "transition-colors duration-150 ease-out-pos",
                    "hover:border-market hover:bg-market-tint",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-market",
                    "active:bg-market-tint",
                  )}
                >
                  <ProductImage product={product} />

                  <span className="line-clamp-2 text-body-lg font-semibold text-ink">
                    {product.name}
                  </span>

                  <span className="flex-1" />

                  <span className="flex items-end justify-between gap-2">
                    <span className="font-numeric font-semibold text-ink">
                      {format(product.price)}
                    </span>
                    {/* Weighed goods behave differently when tapped — they ask
                        for a weight — so they say so before they are tapped. */}
                    {product.soldBy === "weight" && (
                      <span className="flex shrink-0 items-center gap-1 rounded-pill bg-signal-tint px-2 py-0.5 text-label text-signal">
                        <Scale size={13} aria-hidden />
                        per {product.unit}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function CategoryChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "min-h-11 shrink-0 rounded-pill border px-4 font-medium",
        "transition-colors duration-150 ease-out-pos",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-market",
        active
          ? "border-market bg-market text-white"
          : "border-line bg-surface text-ink-70 hover:border-market hover:text-market",
      )}
    >
      {label}
    </button>
  );
}
