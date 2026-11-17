"use client";

import { useId, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { searchProducts } from "@/lib/domain/catalog";
import { cn } from "@/lib/utils/cn";
import type { Product } from "@/types/catalog";

/**
 * Type a name or SKU, pick from the top matches. Used wherever a product is
 * added to a document by hand — a delivery, an order.
 *
 * Arrow keys move through the matches and Enter takes the highlighted one, so
 * a manager keying a twenty-line order never has to reach for the mouse.
 */
export function ProductSearch({
  products,
  onPick,
  placeholder = "Search a product by name or SKU",
  exclude,
  className,
}: {
  products: readonly Product[];
  onPick: (product: Product) => void;
  placeholder?: string;
  /** Products already on the document, shown as such rather than hidden. */
  exclude?: ReadonlySet<string>;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();

  const matches = useMemo(
    () =>
      query.trim()
        ? searchProducts(
            products.filter((p) => !p.delistedAt),
            query,
          ).slice(0, 8)
        : [],
    [products, query],
  );

  function pick(product: Product) {
    onPick(product);
    setQuery("");
    setActive(0);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (matches.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => (i + 1) % matches.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => (i - 1 + matches.length) % matches.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      pick(matches[Math.min(active, matches.length - 1)]);
    } else if (event.key === "Escape") {
      event.stopPropagation();
      setQuery("");
    }
  }

  return (
    <div className={cn("relative", className)}>
      <Search
        size={17}
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-40"
      />
      <input
        type="search"
        role="combobox"
        aria-expanded={matches.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label={placeholder}
        className="min-h-touch-admin w-full rounded-input border border-line bg-surface pr-3 pl-9 text-body text-ink placeholder:text-ink-40 transition-colors duration-150 ease-out-pos hover:border-ink-40 focus:border-market focus:outline-2 focus:-outline-offset-2 focus:outline-market"
      />
      {matches.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute inset-x-0 top-full z-20 mt-1 max-h-80 overflow-y-auto rounded-input border border-line bg-surface shadow-raised"
        >
          {matches.map((product, i) => {
            const already = exclude?.has(product.id);
            return (
              <li key={product.id} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(product)}
                  className={cn(
                    "flex min-h-touch-admin w-full items-center justify-between gap-3 px-3 text-left",
                    i === active ? "bg-market-tint" : "hover:bg-market-tint",
                  )}
                >
                  <span className="min-w-0 truncate text-ink">{product.name}</span>
                  <span className="shrink-0 font-mono text-label tracking-normal text-ink-40">
                    {already ? "On the list · adds 1" : product.sku}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
