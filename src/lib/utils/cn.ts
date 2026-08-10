import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * `cn` — clsx for conditionals, tailwind-merge for last-one-wins.
 *
 * tailwind-merge has to be told about the §14 scales. It resolves conflicts by
 * bucketing a class into a group, and for a class it does not recognise it
 * guesses from the shape of the value. Every one of our type-scale tokens is a
 * bare word, so `text-body-lg` was being read as a *colour* and put in the same
 * bucket as `text-white`:
 *
 *     cn("bg-market text-white", "text-body-lg")  →  "bg-market text-body-lg"
 *
 * which is how every primary button lost its white label and rendered black on
 * green. The mirror image cost inputs their font size, since `text-ink` landed
 * in the same bucket and won. Declaring the scales below fixes both directions.
 *
 * Keep these lists in step with the `@theme` block in `src/app/globals.css`.
 * A token added there and forgotten here is a silently mis-merged class.
 */

const FONT_SIZES = [
  "display-xl",
  "display-lg",
  "title",
  "body-lg",
  "body",
  "label",
  "mono",
] as const;

const COLORS = [
  "ink",
  "ink-70",
  "ink-40",
  "paper",
  "surface",
  "line",
  "leaf",
  "market",
  "market-dark",
  "market-tint",
  "zest",
  "zest-deep",
  "zest-tint",
  "sun",
  "signal",
  "signal-tint",
  "halt",
  "halt-tint",
  "info",
] as const;

const RADII = ["input", "card", "panel", "pill"] as const;

const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      // Feeds every colour-consuming group at once — text, bg, border, ring,
      // fill, stroke, outline, divide, accent, caret, shadow-color.
      color: [...COLORS],
      radius: [...RADII],
    },
    classGroups: {
      "font-size": [{ text: [...FONT_SIZES] }],
      shadow: ["shadow-raised"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
