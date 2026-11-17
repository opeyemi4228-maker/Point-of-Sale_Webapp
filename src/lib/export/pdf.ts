"use client";

import type { jsPDF as JsPdf } from "jspdf";
import { cellText, saveBlob, type CellTone, type ReportCell, type ReportSpec } from "./report";

/**
 * The report as a branded A4 PDF.
 *
 * Generated in the browser from data already on screen, so it works with the
 * network down (CLAUDE.md rule 8) and nothing leaves the device until the
 * person chooses to send the file.
 *
 * Two details that are not decoration:
 *
 * - **The font is embedded.** jsPDF's built-in Helvetica is Latin-1 and has no
 *   naira sign — every amount would print as `¦12,600` or a blank. Inter is
 *   embedded instead (OFL, `public/fonts/`), fetched once and only when a
 *   report is actually generated, so it never weighs on a page load.
 * - **Colours come from the design tokens.** Rule 5 keeps hex values in
 *   `globals.css`; this reads the same custom properties at runtime rather
 *   than restating them.
 *
 * jsPDF is imported dynamically for the same reason as the font: ~350 KB that
 * the till and every screen that never exports should not pay for.
 */

type Rgb = [number, number, number];

/** A design token as RGB. Neutral fallbacks keep a report legible if one is missing. */
function token(name: string, fallback: number): Rgb {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(`--color-${name}`).trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(raw);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(raw);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return [fallback, fallback, fallback];
}

function palette() {
  return {
    ink: token("ink", 0),
    ink70: token("ink-70", 74),
    ink40: token("ink-40", 110),
    line: token("line", 228),
    paper: token("paper", 250),
    surface: token("surface", 255),
    market: token("market", 70),
    marketTint: token("market-tint", 242),
    halt: token("halt", 0),
    signal: token("signal", 60),
  };
}

type Palette = ReturnType<typeof palette>;

/* ── Assets, fetched once per page load ───────────────────────────────────── */

let fontCache: Promise<{ regular: string; bold: string }> | null = null;
let logoCache: Promise<string | null> | null = null;

async function toBase64(response: Response): Promise<string> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  // Chunked: spreading a 340 KB array into one call overflows the stack.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function loadFonts() {
  fontCache ??= Promise.all([
    fetch("/fonts/Inter-Regular.ttf").then(toBase64),
    fetch("/fonts/Inter-Bold.ttf").then(toBase64),
  ])
    .then(([regular, bold]) => ({ regular, bold }))
    .catch((error) => {
      fontCache = null; // let the next attempt retry rather than cache a failure
      throw error;
    });
  return fontCache;
}

function loadLogo() {
  logoCache ??= fetch("/logo.png")
    .then(async (r) => (r.ok ? `data:image/png;base64,${await toBase64(r)}` : null))
    .catch(() => null);
  return logoCache;
}

/* ── Layout ───────────────────────────────────────────────────────────────── */

const MARGIN = 14; // mm
const FONT = "Inter";

const toneColour = (tone: CellTone | undefined, p: Palette): Rgb | undefined =>
  tone === "halt" ? p.halt : tone === "signal" ? p.signal : tone === "market" ? p.market : tone === "muted" ? p.ink40 : undefined;

function bodyCell(cell: ReportCell, p: Palette) {
  if (cell === null || typeof cell !== "object") return { content: cellText(cell) };
  const colour = toneColour(cell.tone, p);
  return {
    content: cell.text,
    styles: {
      ...(colour ? { textColor: colour } : {}),
      ...(cell.bold ? { fontStyle: "bold" as const } : {}),
    },
  };
}

/**
 * A blank A4 document with Inter embedded and the token palette resolved —
 * the starting point for anything printed that is not a tabular report
 * (shelf labels, for one).
 */
export async function prepareDocument(orientation: "portrait" | "landscape" = "portrait") {
  const [{ jsPDF }, fonts] = await Promise.all([import("jspdf"), loadFonts()]);
  const doc = new jsPDF({ orientation, unit: "mm", format: "a4" });
  doc.addFileToVFS("Inter-Regular.ttf", fonts.regular);
  doc.addFileToVFS("Inter-Bold.ttf", fonts.bold);
  doc.addFont("Inter-Regular.ttf", FONT, "normal");
  doc.addFont("Inter-Bold.ttf", FONT, "bold");
  doc.setFont(FONT, "normal");
  return { doc, palette: palette(), font: FONT };
}

export type PdfContext = {
  /** Who pressed the button. Printed on every page. */
  preparedBy?: string;
  /** When, already formatted for Lagos. */
  generatedAt: string;
};

export async function buildPdf(spec: ReportSpec, context: PdfContext): Promise<JsPdf> {
  const [{ jsPDF }, { autoTable }, fonts, logo] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
    loadFonts(),
    loadLogo(),
  ]);

  const p = palette();
  const doc = new jsPDF({ orientation: spec.orientation ?? "portrait", unit: "mm", format: "a4" });
  doc.addFileToVFS("Inter-Regular.ttf", fonts.regular);
  doc.addFileToVFS("Inter-Bold.ttf", fonts.bold);
  doc.addFont("Inter-Regular.ttf", FONT, "normal");
  doc.addFont("Inter-Bold.ttf", FONT, "bold");
  doc.setFont(FONT, "normal");
  doc.setProperties({ title: spec.title, subject: spec.subtitle ?? spec.title, creator: "Swiftgrocers POS" });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - MARGIN * 2;
  let y = MARGIN;

  /* Masthead: mark, title, scope. A thin brand rule closes it. */
  if (logo) {
    // logo.png is 155 × 80.
    doc.addImage(logo, "PNG", MARGIN, y, 19.4, 10);
  }
  doc.setFont(FONT, "bold");
  doc.setFontSize(8);
  doc.setTextColor(...p.ink40);
  doc.text("SWIFTGROCERS POS", pageWidth - MARGIN, y + 3, { align: "right", charSpace: 0.4 });
  doc.setFont(FONT, "normal");
  doc.text(context.generatedAt, pageWidth - MARGIN, y + 7.5, { align: "right" });

  y += 17;
  doc.setFont(FONT, "bold");
  doc.setFontSize(19);
  doc.setTextColor(...p.ink);
  doc.text(spec.title, MARGIN, y);
  y += 6.5;
  if (spec.subtitle) {
    doc.setFont(FONT, "normal");
    doc.setFontSize(10.5);
    doc.setTextColor(...p.ink70);
    const lines = doc.splitTextToSize(spec.subtitle, contentWidth) as string[];
    doc.text(lines, MARGIN, y);
    y += lines.length * 4.6;
  }
  y += 1.5;
  doc.setDrawColor(...p.market);
  doc.setLineWidth(0.6);
  doc.line(MARGIN, y, pageWidth - MARGIN, y);
  y += 6;

  /* Meta: label over value, in as many columns as fit. */
  const meta = [
    ...(spec.meta ?? []),
    ...(context.preparedBy ? [{ label: "Prepared by", value: context.preparedBy }] : []),
  ];
  if (meta.length) {
    const perRow = spec.orientation === "landscape" ? 5 : 4;
    const colWidth = contentWidth / perRow;
    for (let i = 0; i < meta.length; i += perRow) {
      const row = meta.slice(i, i + perRow);
      let tallest = 1;
      row.forEach((item, j) => {
        const x = MARGIN + j * colWidth;
        doc.setFont(FONT, "bold");
        doc.setFontSize(7);
        doc.setTextColor(...p.ink40);
        doc.text(item.label.toUpperCase(), x, y, { charSpace: 0.3 });
        doc.setFont(FONT, "normal");
        doc.setFontSize(9.5);
        doc.setTextColor(...p.ink);
        const lines = doc.splitTextToSize(item.value, colWidth - 4) as string[];
        doc.text(lines.slice(0, 2), x, y + 4.3);
        tallest = Math.max(tallest, Math.min(lines.length, 2));
      });
      y += 5 + tallest * 4.2;
    }
    y += 2;
  }

  /* Headline tiles. */
  if (spec.summary?.length) {
    const count = spec.summary.length;
    const gap = 3;
    const tileWidth = (contentWidth - gap * (count - 1)) / count;
    const tileHeight = spec.summary.some((s) => s.hint) ? 19 : 15;
    spec.summary.forEach((tile, i) => {
      const x = MARGIN + i * (tileWidth + gap);
      doc.setFillColor(...p.paper);
      doc.setDrawColor(...p.line);
      doc.setLineWidth(0.25);
      doc.roundedRect(x, y, tileWidth, tileHeight, 1.5, 1.5, "FD");
      doc.setFont(FONT, "bold");
      doc.setFontSize(6.8);
      doc.setTextColor(...p.ink40);
      doc.text(tile.label.toUpperCase(), x + 3.5, y + 5, { charSpace: 0.25, maxWidth: tileWidth - 7 });
      doc.setFontSize(count > 4 ? 12 : 14);
      doc.setTextColor(...p.ink);
      doc.text(tile.value, x + 3.5, y + 11.5, { maxWidth: tileWidth - 7 });
      if (tile.hint) {
        doc.setFont(FONT, "normal");
        doc.setFontSize(7.5);
        doc.setTextColor(...p.ink70);
        doc.text(tile.hint, x + 3.5, y + 16, { maxWidth: tileWidth - 7 });
      }
    });
    y += tileHeight + 7;
  }

  /* Tables. */
  for (const table of spec.tables) {
    if (y > pageHeight - 40) {
      doc.addPage();
      y = MARGIN + 10;
    }
    if (table.heading) {
      doc.setFont(FONT, "bold");
      doc.setFontSize(11);
      doc.setTextColor(...p.ink);
      doc.text(table.heading, MARGIN, y);
      y += 1.5;
    }
    if (table.note) {
      doc.setFont(FONT, "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(...p.ink70);
      const lines = doc.splitTextToSize(table.note, contentWidth) as string[];
      doc.text(lines, MARGIN, y + 4);
      y += lines.length * 3.8 + 1;
    }
    y += 2.5;

    const weights = table.columns.map((c) => c.width);
    const totalWeight = weights.reduce<number>((n, w) => n + (w ?? 0), 0);
    const columnStyles = Object.fromEntries(
      table.columns.map((column, i) => [
        i,
        {
          halign: column.align ?? "left",
          ...(column.mono ? { font: "courier", fontSize: 8 } : {}),
          ...(column.width && totalWeight ? { cellWidth: (column.width / totalWeight) * contentWidth } : {}),
        },
      ]),
    );

    const body =
      table.rows.length > 0
        ? table.rows.map((row) => row.map((cell) => bodyCell(cell, p)))
        : [
            [
              {
                content: table.empty ?? "Nothing to show for this selection.",
                colSpan: table.columns.length,
                styles: { halign: "center" as const, textColor: p.ink70, cellPadding: 5 },
              },
            ],
          ];

    autoTable(doc, {
      startY: y,
      margin: { left: MARGIN, right: MARGIN, top: MARGIN + 10, bottom: 16 },
      head: [table.columns.map((c, i) => ({ content: c.header, styles: { halign: columnStyles[i].halign } }))],
      body,
      foot: table.totals ? [table.totals.map((cell) => bodyCell(cell, p))] : undefined,
      showFoot: "lastPage",
      theme: "plain",
      styles: {
        font: FONT,
        fontSize: 8.5,
        textColor: p.ink,
        cellPadding: { top: 2.1, bottom: 2.1, left: 2.4, right: 2.4 },
        lineColor: p.line,
        valign: "middle",
        overflow: "linebreak",
      },
      headStyles: {
        font: FONT,
        fontStyle: "bold",
        fontSize: 7.5,
        textColor: p.surface,
        fillColor: p.ink,
      },
      footStyles: {
        font: FONT,
        fontStyle: "bold",
        fillColor: p.marketTint,
        textColor: p.ink,
      },
      alternateRowStyles: { fillColor: p.paper },
      bodyStyles: { lineWidth: { bottom: 0.15 } },
      columnStyles,
    });

    // `lastAutoTable` is how the plugin reports where it stopped.
    y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 9;
  }

  if (spec.footnote) {
    if (y > pageHeight - 26) {
      doc.addPage();
      y = MARGIN + 10;
    }
    doc.setFont(FONT, "normal");
    doc.setFontSize(8);
    doc.setTextColor(...p.ink70);
    doc.text(doc.splitTextToSize(spec.footnote, contentWidth) as string[], MARGIN, y);
  }

  /* Running header and footer on every page, now the page count is known. */
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    if (page > 1) {
      doc.setFont(FONT, "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(...p.ink);
      doc.text(spec.title, MARGIN, MARGIN + 2);
      doc.setFont(FONT, "normal");
      doc.setTextColor(...p.ink40);
      if (spec.subtitle) doc.text(spec.subtitle, pageWidth - MARGIN, MARGIN + 2, { align: "right", maxWidth: contentWidth / 2 });
      doc.setDrawColor(...p.line);
      doc.setLineWidth(0.25);
      doc.line(MARGIN, MARGIN + 4.5, pageWidth - MARGIN, MARGIN + 4.5);
    }
    doc.setDrawColor(...p.line);
    doc.setLineWidth(0.25);
    doc.line(MARGIN, pageHeight - 11, pageWidth - MARGIN, pageHeight - 11);
    doc.setFont(FONT, "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...p.ink40);
    const left = [`Swiftgrocers · ${spec.title}`, context.preparedBy ? `prepared by ${context.preparedBy}` : null]
      .filter(Boolean)
      .join(" · ");
    doc.text(left, MARGIN, pageHeight - 7);
    doc.text(`Page ${page} of ${pages}`, pageWidth - MARGIN, pageHeight - 7, { align: "right" });
  }

  return doc;
}

export async function downloadPdf(spec: ReportSpec, context: PdfContext) {
  const doc = await buildPdf(spec, context);
  saveBlob(doc.output("blob"), `${spec.filename}.pdf`);
}
