/**
 * The sign-in panel's decorative mosaic.
 *
 * A grid of abstract tiles built entirely from the §14 tokens — inline SVG can
 * read CSS custom properties, so there is not a hex value in here. The motifs
 * are chosen to mean something rather than to decorate: a barcode, receipt tape,
 * a naira glyph, a bar chart, and the bag from the logo.
 *
 * The palette is the logo's — leaf green, the wordmark orange, black and white
 * — plus the system's yellow. Orange and yellow are punctuation, not field
 * colours: five tiles out of twenty carry one, spread so that no two touch.
 *
 * Purely presentational — `aria-hidden`, and it never carries information.
 */

type Motif =
  | "leaf"
  | "barcode"
  | "arcs"
  | "spark"
  | "dots"
  | "mark"
  | "diagonal"
  | "waves"
  | "circle"
  | "tape"
  | "triangles"
  | "bars"
  | "naira"
  | "halfCircle"
  | "cross"
  | "solid";

type Tile = { motif: Motif; bg: string; fg: string };

const T = "var(--color-market-tint)"; // pale wash
const L = "var(--color-leaf)"; // the logo green
const M = "var(--color-market)"; // the readable green
const D = "var(--color-market-dark)"; // the deep green
const K = "var(--color-ink)"; // black
const W = "var(--color-surface)"; // white
const Z = "var(--color-zest)"; // the logo orange
const Y = "var(--color-sun)"; // yellow — the eye's resting point

// 4 columns × 5 rows, read left to right, top to bottom.
const TILES: Tile[] = [
  { motif: "leaf", bg: D, fg: L },
  { motif: "barcode", bg: K, fg: W },
  { motif: "arcs", bg: L, fg: T },
  { motif: "spark", bg: D, fg: Y },

  { motif: "dots", bg: M, fg: T },
  { motif: "mark", bg: L, fg: W },
  { motif: "diagonal", bg: T, fg: L },
  { motif: "circle", bg: K, fg: Z },

  { motif: "waves", bg: L, fg: W },
  { motif: "tape", bg: W, fg: K },
  { motif: "bars", bg: D, fg: L },
  { motif: "halfCircle", bg: T, fg: D },

  { motif: "naira", bg: M, fg: W },
  { motif: "triangles", bg: Z, fg: W },
  { motif: "cross", bg: L, fg: D },
  { motif: "leaf", bg: K, fg: L },

  { motif: "arcs", bg: T, fg: D },
  { motif: "solid", bg: L, fg: L },
  { motif: "dots", bg: D, fg: L },
  { motif: "circle", bg: M, fg: Y },
];

const COLS = 4;
const SIZE = 100;

export function BrandMosaic({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={className}
      viewBox={`0 0 ${COLS * SIZE} ${(TILES.length / COLS) * SIZE}`}
      preserveAspectRatio="xMidYMid slice"
    >
      {TILES.map((tile, index) => (
        <g
          key={index}
          transform={`translate(${(index % COLS) * SIZE} ${Math.floor(index / COLS) * SIZE})`}
        >
          <rect width={SIZE} height={SIZE} fill={tile.bg} />
          <MotifShape {...tile} />
        </g>
      ))}
    </svg>
  );
}

function MotifShape({ motif, fg }: Tile) {
  switch (motif) {
    case "solid":
      return null;

    // The bag from the logo, full bleed. Same geometry as logo-mark.svg.
    case "mark":
      return (
        <g transform="translate(50 51) scale(2.4) translate(-16 -16)">
          <circle cx={11.9} cy={11.6} r={3.1} fill={fg} fillOpacity={0.42} />
          <circle cx={19.6} cy={10.6} r={3.9} fill={fg} fillOpacity={0.7} />
          <path
            d="M10.5 12.8V7.4a5.5 5.5 0 0 1 11 0v5.4"
            fill="none"
            stroke={fg}
            strokeOpacity={0.9}
            strokeWidth={1.9}
            strokeLinecap="round"
          />
          <path
            d="M4.6 12.4h22.8v11.4A5.2 5.2 0 0 1 22.2 29H9.8a5.2 5.2 0 0 1-5.2-5.2Z"
            fill={fg}
          />
        </g>
      );

    // A single leaf, drawn as two facing quarter-circles.
    case "leaf":
      return (
        <path
          d="M8 92A84 84 0 0 1 92 8A84 84 0 0 1 8 92Z"
          fill={fg}
        />
      );

    case "barcode": {
      const widths = [3, 6, 2, 4, 8, 2, 3, 5, 2, 7, 3, 2, 5, 4, 2, 6];
      let x = 12;
      return (
        <g fill={fg}>
          {widths.map((w, i) => {
            const bar = <rect key={i} x={x} y={22} width={w} height={44} rx={0.5} />;
            x += w + 3;
            return x <= 92 ? bar : null;
          })}
          <rect x={12} y={74} width={62} height={3} rx={1.5} fillOpacity={0.45} />
        </g>
      );
    }

    case "arcs":
      return (
        <g fill="none" stroke={fg} strokeWidth={6}>
          {[22, 42, 62, 82].map((r) => (
            <path key={r} d={`M0 ${100 - r}A${r} ${r} 0 0 0 ${r} 100`} />
          ))}
        </g>
      );

    case "spark":
      return (
        <g fill={fg}>
          <path d="M50 22 57 43 78 50 57 57 50 78 43 57 22 50 43 43Z" />
        </g>
      );

    case "dots":
      return (
        <g fill={fg}>
          {[0, 1, 2, 3, 4].map((row) =>
            [0, 1, 2, 3, 4].map((col) => (
              <circle key={`${row}-${col}`} cx={18 + col * 16} cy={18 + row * 16} r={3.4} />
            )),
          )}
        </g>
      );

    case "diagonal":
      return <path d="M0 100 100 0V100Z" fill={fg} />;

    case "waves":
      return (
        <g fill="none" stroke={fg} strokeWidth={5} strokeLinecap="round">
          {[32, 52, 72].map((y) => (
            <path
              key={y}
              d={`M8 ${y}q12 -12 24 0t24 0t24 0`}
            />
          ))}
        </g>
      );

    case "circle":
      return <circle cx={50} cy={50} r={30} fill={fg} />;

    case "halfCircle":
      return <path d="M0 100A100 100 0 0 1 100 0V100Z" fill={fg} fillOpacity={0.9} />;

    // Receipt tape: lines of print above a perforated tear-off edge (§14).
    case "tape":
      return (
        <g fill={fg}>
          {[20, 32, 44, 56].map((y, i) => (
            <rect
              key={y}
              x={16}
              y={y}
              width={i === 3 ? 40 : 68}
              height={4}
              rx={2}
              fillOpacity={i === 3 ? 0.4 : 0.75}
            />
          ))}
          <g fillOpacity={0.28}>
            {[16, 30, 44, 58, 72].map((x) => (
              <circle key={x} cx={x + 6} cy={80} r={3.2} />
            ))}
          </g>
        </g>
      );

    case "triangles":
      return (
        <g fill={fg}>
          <path d="M50 18 74 52H26Z" />
          <path d="M50 54 74 88H26Z" fillOpacity={0.55} />
        </g>
      );

    // Sales by hour, in miniature.
    case "bars": {
      const heights = [26, 44, 34, 58, 40];
      return (
        <g fill={fg}>
          {heights.map((h, i) => (
            <rect
              key={i}
              x={16 + i * 15}
              y={80 - h}
              width={9}
              height={h}
              rx={3}
            />
          ))}
        </g>
      );
    }

    // ₦ — the only currency this system knows. Built from rects rather than
    // strokes: square line caps on the diagonal overshot the stems and read as
    // a smudge at tile scale.
    case "naira":
      return (
        <g fill={fg}>
          <rect x={33} y={30} width={7} height={40} />
          <rect x={60} y={30} width={7} height={40} />
          <rect x={26} y={41} width={48} height={6} />
          <rect x={26} y={54} width={48} height={6} />
          <path d="M40 30h6l14 40h-6Z" />
        </g>
      );

    case "cross":
      return (
        <g stroke={fg} strokeWidth={5} strokeLinecap="round">
          {[28, 50, 72].map((y) =>
            [28, 50, 72].map((x) => (
              <g key={`${x}-${y}`}>
                <path d={`M${x - 7} ${y}h14`} />
                <path d={`M${x} ${y - 7}v14`} />
              </g>
            )),
          )}
        </g>
      );
  }
}
