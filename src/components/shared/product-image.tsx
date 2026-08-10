"use client";

import { useState } from "react";
import { cn } from "@/lib/utils/cn";
import type { Product } from "@/types/catalog";

/**
 * The photograph on a product tile — SPEC §15.1.
 *
 * **Real photographs only.** An earlier version drew a category illustration
 * when a product had no photo, which meant rice, garri and beans — all
 * "Staples" — showed the identical green sack. A picture that is the same for
 * every product in a category tells a cashier nothing, and it was taking half
 * the tile to do it. The name and the price are what get read; a stand-in that
 * pushes them down makes the screen slower, not richer.
 *
 * So this renders nothing at all unless there is a real image, and the tile
 * falls back to a text-forward layout that is faster to scan anyway.
 *
 * **Where photos come from.** Either the catalog supplies an absolute
 * `imageUrl`, or a file is dropped into `public/products/<SKU>.jpg` — see the
 * README in that folder. Nothing else has to change for photography to appear:
 * add the file, and the tile has a picture on the next load.
 */
export function ProductImage({
  product,
  className,
}: {
  product: Product;
  className?: string;
}) {
  // By SKU, so a photo can be added by filename alone with no code change.
  const src = product.imageUrl ?? `/products/${product.sku}.jpg`;

  // A missing file is the normal case today, not an error worth reporting.
  const [failed, setFailed] = useState(false);

  // The slot is kept whether or not there is a photo, so every tile in the grid
  // is the same height. Letting it collapse produced a ragged masonry where
  // half the tiles were twice the height of their neighbours, which is harder
  // to scan than any missing picture — and it moved the prices out of line.
  // An empty slot is quiet: a flat wash, no drawn stand-in.
  if (failed) {
    return (
      <div
        aria-hidden
        className={cn("w-full shrink-0 rounded-card bg-paper", className)}
        style={{ aspectRatio: "4 / 3" }}
      />
    );
  }

  return (
    <div
      className={cn(
        "relative aspect-4/3 w-full shrink-0 overflow-hidden rounded-card bg-white",
        className,
      )}
    >
      {/* Catalog photos may be remote and arbitrary. `next/image` needs a
          configured host allowlist, and that configuration belongs with the
          real catalog service rather than with this component. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className="size-full object-cover"
      />
    </div>
  );
}
