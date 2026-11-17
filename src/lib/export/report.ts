import { formatWhole, toNaira, type Money } from "@/lib/domain/money";
import { formatQty, toNumber, type Quantity } from "@/lib/domain/quantity";

/**
 * A printable, downloadable report — one description, two renderings.
 *
 * Every screen that exports describes *what* the report says (title, scope,
 * headline figures, tables) and never *how* it is drawn. The PDF renderer
 * (`pdf.ts`) and the CSV renderer (below) both read this shape, so a stock
 * sheet emailed to HQ as a PDF and the same sheet opened in Excel cannot
 * disagree about a single figure.
 *
 * Money is carried twice per cell: the formatted text a person reads
 * (`₦12,600`) and the raw naira a spreadsheet can sum (`12600`). Both come from
 * the same integer-kobo `Money`, so neither is ever recomputed from the other.
 */

export type Align = "left" | "right" | "center";

/** Emphasis only. The text of the cell always carries the meaning too (§14). */
export type CellTone = "halt" | "signal" | "market" | "muted";

export type ReportCell =
  | string
  | number
  | null
  | {
      text: string;
      /** What a spreadsheet should get instead of `text`, e.g. bare naira. */
      raw?: string | number;
      tone?: CellTone;
      bold?: boolean;
    };

export type ReportColumn = {
  header: string;
  align?: Align;
  /** Codes — part numbers, barcodes, references — set in monospace. */
  mono?: boolean;
  /** Relative width hint for the PDF. Omit to let the table decide. */
  width?: number;
};

export type ReportTable = {
  heading?: string;
  note?: string;
  columns: ReportColumn[];
  rows: ReportCell[][];
  /** A bold closing row, e.g. column totals. */
  totals?: ReportCell[];
  /** What to print when there are no rows — never a blank table. */
  empty?: string;
};

export type ReportSpec = {
  /** "Stock on hand". */
  title: string;
  /** "Gwarinpa branch · valued at cost". */
  subtitle?: string;
  /** File name without extension: `stock-on-hand_GWA_2026-11-17`. */
  filename: string;
  orientation?: "portrait" | "landscape";
  /** Branch, period, filters — what the reader needs to trust the figures. */
  meta?: { label: string; value: string }[];
  /** Headline figures, drawn as tiles above the tables. */
  summary?: { label: string; value: string; hint?: string }[];
  tables: ReportTable[];
  /** A closing line of small print, e.g. how the figures were derived. */
  footnote?: string;
  /**
   * Tables for the CSV only, when the spreadsheet wants a different shape from
   * the page — typically one wide grid that a PDF would have to split up.
   */
  csv?: ReportTable[];
};

/* ── Cell helpers ─────────────────────────────────────────────────────────── */

/** `₦12,600` to read, `12600` to sum. */
export const moneyCell = (amount: Money, options: { tone?: CellTone; bold?: boolean } = {}): ReportCell => ({
  text: formatWhole(amount),
  raw: toNaira(amount),
  tone: options.tone ?? (amount.kobo < 0 ? "halt" : undefined),
  bold: options.bold,
});

/** `12.5 kg` to read, `12.5` to sum. Negative stock is flagged, never hidden. */
export const qtyCell = (
  amount: Quantity,
  unit?: string,
  options: { signed?: boolean; tone?: CellTone; bold?: boolean } = {},
): ReportCell => {
  const sign = options.signed && amount.milli > 0 ? "+" : "";
  return {
    text: `${sign}${formatQty(amount)}${unit ? ` ${unit}` : ""}`,
    raw: toNumber(amount),
    tone: options.tone ?? (amount.milli < 0 && !options.signed ? "halt" : undefined),
    bold: options.bold,
  };
};

export const cellText = (cell: ReportCell): string =>
  cell === null ? "" : typeof cell === "object" ? cell.text : String(cell);

const cellRaw = (cell: ReportCell): string | number =>
  cell === null ? "" : typeof cell === "object" ? (cell.raw ?? cell.text) : cell;

/** A file name that survives every OS and every email client. */
export function reportFilename(...parts: (string | null | undefined)[]): string {
  return parts
    .filter((p): p is string => Boolean(p))
    .map((p) => p.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, ""))
    .filter(Boolean)
    .join("_");
}

/* ── CSV ──────────────────────────────────────────────────────────────────── */

const escapeCsv = (value: string | number) => {
  // A barcode is a code, not a number. Left bare, Excel shows 6151000000010
  // as 6.15E+12 and drops a leading zero from a UPC — and saving the file
  // back writes the damage in. A formula that yields the text keeps every
  // digit in Excel and Google Sheets alike.
  if (typeof value === "string" && /^\d{8,}$|^0\d+$/.test(value)) return `="${value}"`;
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

/**
 * The report as CSV, for Excel and Google Sheets.
 *
 * Money and quantities go out raw — bare numbers a spreadsheet can total — with
 * the unit in the header instead of in every cell. A single-table report is a
 * clean grid with no preamble, so it imports without editing; a report with
 * several tables separates them with a heading row and a blank line.
 *
 * Starts with a byte-order mark: without it Excel on Windows opens the file as
 * ANSI and every product name with an accent, and every ₦, turns to mojibake.
 */
export function toCsv(spec: ReportSpec): string {
  const tables = spec.csv ?? spec.tables;
  const many = tables.length > 1;
  const blocks = tables.map((table) => {
    const lines: (string | number)[][] = [];
    if (many && table.heading) lines.push([table.heading]);
    lines.push(table.columns.map((c) => c.header));
    for (const row of table.rows) lines.push(row.map(cellRaw));
    if (table.totals) lines.push(table.totals.map(cellRaw));
    return lines.map((cells) => cells.map(escapeCsv).join(",")).join("\r\n");
  });
  return `﻿${blocks.join("\r\n\r\n")}\r\n`;
}

/** Hand the browser a file to save. */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked on the next tick: Safari cancels a download whose URL is revoked
  // in the same task that started it.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadCsv(spec: ReportSpec) {
  saveBlob(new Blob([toCsv(spec)], { type: "text/csv;charset=utf-8" }), `${spec.filename}.csv`);
}
