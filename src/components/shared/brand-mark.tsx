import Image from "next/image";
import logo from "../../../public/logo.png";
import { cn } from "@/lib/utils/cn";

/**
 * The Swiftgrocers logo.
 *
 * `public/logo.png` is the brand asset and the only correct rendering of the
 * lockup — the wordmark is a bespoke brush script, so there is no typeface that
 * reproduces it and no live-text version that would be honest. On light
 * surfaces we show the artwork itself.
 *
 * On dark surfaces we cannot: a full-colour raster does not reverse, and the
 * logo's orange on the market green is a 1.6:1 mud. So `tone="paper"` swaps to
 * the reversed mark from `public/logo-mark-white.svg` alongside a wordmark set
 * in Chivo — a signage grotesque (§14), which is the closest honest stand-in
 * when the real artwork cannot be used.
 *
 * A lockup is specified by height, never by width; `height` drives everything
 * and the width follows the artwork's own 155:80 ratio.
 *
 * `unoptimized` is deliberate. This is 9 KB of flat colour rendered around
 * 32px tall — the optimizer's default quality of 75 costs sharpness on the
 * wordmark's thin strokes and saves nothing. The static import still gives us
 * intrinsic dimensions (so no layout shift) and a hashed, immutably cached URL.
 */

const LOCKUP_RATIO = logo.width / logo.height;

export function BrandMark({
  className,
  tone = "ink",
  /** Height of the lockup, or the side of the square mark, in px. */
  height = 32,
  showWordmark = true,
  title,
  preload = false,
}: {
  className?: string;
  tone?: "ink" | "paper";
  height?: number;
  showWordmark?: boolean;
  title?: string;
  /** Set on the sign-in lockup, which is the page's largest paint. */
  preload?: boolean;
}) {
  const onDark = tone === "paper";

  // The real artwork, whenever the ground is light enough to carry it.
  if (showWordmark && !onDark) {
    return (
      <Image
        src={logo}
        alt="Swiftgrocers"
        title={title}
        height={height}
        width={Math.round(height * LOCKUP_RATIO)}
        unoptimized
        preload={preload || undefined}
        className={cn("block h-auto w-auto select-none", className)}
        style={{ height, width: "auto" }}
      />
    );
  }

  return (
    <span title={title} className={cn("inline-flex items-center gap-2.5", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- an SVG is already
          vector; the optimizer returns 400 for it unless dangerouslyAllowSVG is
          set, and enabling that chain-wide to serve one mark is a poor trade. */}
      <img
        src={onDark ? "/logo-mark-white.svg" : "/logo-mark.svg"}
        alt={showWordmark ? "" : "Swiftgrocers"}
        aria-hidden={showWordmark || undefined}
        width={height}
        height={height}
        className="shrink-0"
        style={{ width: height, height }}
      />

      {showWordmark && (
        <span
          className="font-display font-black tracking-[-0.02em] text-white"
          style={{ fontSize: Math.round(height * 0.6) }}
        >
          Swift<span className="text-white/70">grocers</span>
        </span>
      )}
    </span>
  );
}
