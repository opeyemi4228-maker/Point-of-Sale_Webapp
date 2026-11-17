import { ean13Modules } from "@/lib/domain/product-master";
import { cn } from "@/lib/utils/cn";

/**
 * An EAN-13 drawn as SVG — scannable off the screen, and the same shape a
 * shelf label will print.
 *
 * Guard bars run longer than the data bars, as on a real label, and the digits
 * sit under each half in the standard 1 · 6 · 6 grouping. Codes that are not a
 * valid EAN-13 render as the code itself in a box: drawing bars for a code that
 * fails its checksum would make a label no scanner accepts.
 *
 * Colour comes from `currentColor` over the surface token, so it stays black
 * on white in print and never picks up a tint.
 */
export function BarcodeGraphic({ code, className }: { code: string; className?: string }) {
  const modules = ean13Modules(code);

  if (!modules) {
    return (
      <div
        className={cn(
          "flex min-h-20 items-center justify-center rounded-input border border-dashed border-line bg-surface px-4 font-mono text-mono tracking-wider text-ink",
          className,
        )}
      >
        {code}
      </div>
    );
  }

  // 95 modules plus quiet zones: 11 on the left (room for the leading digit), 7 on the right.
  const left = 11;
  const width = left + 95 + 7;
  const barHeight = 50;
  const guardHeight = 56;
  const isGuard = (i: number) => i < 3 || (i >= 45 && i < 50) || i >= 92;

  const bars: { x: number; w: number; guard: boolean }[] = [];
  for (let i = 0; i < 95; i++) {
    if (modules[i] !== "1") continue;
    const last = bars[bars.length - 1];
    const guard = isGuard(i);
    if (last && last.x + last.w === left + i && last.guard === guard) last.w += 1;
    else bars.push({ x: left + i, w: 1, guard });
  }

  return (
    <svg
      viewBox={`0 0 ${width} 66`}
      role="img"
      aria-label={`EAN-13 barcode ${code}`}
      className={cn("h-auto w-full max-w-64 rounded-input bg-surface text-ink", className)}
      shapeRendering="crispEdges"
    >
      {bars.map((bar) => (
        <rect key={bar.x} x={bar.x} y={4} width={bar.w} height={bar.guard ? guardHeight : barHeight} fill="currentColor" />
      ))}
      <g fill="currentColor" fontFamily="var(--font-mono)" fontSize="8.5" textAnchor="middle">
        <text x={left - 5} y={63}>{code[0]}</text>
        <text x={left + 3 + 21} y={63} letterSpacing="1.6">{code.slice(1, 7)}</text>
        <text x={left + 50 + 21} y={63} letterSpacing="1.6">{code.slice(7)}</text>
      </g>
    </svg>
  );
}
