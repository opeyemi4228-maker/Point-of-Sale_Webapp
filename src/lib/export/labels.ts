"use client";

import { formatWhole } from "@/lib/domain/money";
import { classifyBarcode, ean13Modules } from "@/lib/domain/product-master";
import { prepareDocument } from "./pdf";
import { saveBlob } from "./report";
import type { Product } from "@/types/catalog";

/**
 * Shelf-edge labels — SPEC §7.3.
 *
 * Printed on standard A4 label stock: 3 × 8 labels of 63.5 × 33.9 mm (the
 * common "24 per sheet" layout), so any office printer and a pack of labels
 * from a stationer is all a branch needs.
 *
 * Each label carries what a shopper and a stock-taker need, and nothing else:
 * the name, the price large, what the price is per, the part number, and the
 * product's primary barcode — drawn as real bars, so a handheld can scan the
 * shelf edge during a count. The print date is on every label, because the
 * first question about a disputed shelf price is "how old is that label?".
 *
 * Bars are 0.27 mm per module (26 mm across 95 modules), above the EAN-13
 * minimum X-dimension of 0.264 mm, so they scan.
 */

const COLS = 3;
const ROWS = 8;
const W = 63.5;
const H = 33.9;
const GAP_X = 2.5;
const LEFT = (210 - COLS * W - (COLS - 1) * GAP_X) / 2;
const TOP = (297 - ROWS * H) / 2;
const PAD = 3;

export type LabelRequest = { product: Product; copies: number };

export async function downloadShelfLabels(
  requests: readonly LabelRequest[],
  options: { printedOn: string; isoDay: string },
) {
  const printedOn = `Printed ${options.printedOn}`;
  const { doc, palette: p, font } = await prepareDocument("portrait");
  doc.setProperties({ title: "Shelf labels", creator: "Swiftgrocers POS" });

  const labels = requests.flatMap((r) => Array.from({ length: Math.max(0, Math.min(r.copies, 240)) }, () => r.product));
  labels.forEach((product, i) => {
    const slot = i % (COLS * ROWS);
    if (i > 0 && slot === 0) doc.addPage();
    const x = LEFT + (slot % COLS) * (W + GAP_X);
    const y = TOP + Math.floor(slot / COLS) * H;

    // Cut guide: a hairline in the line token, invisible once the label is peeled.
    doc.setDrawColor(...p.line);
    doc.setLineWidth(0.15);
    doc.roundedRect(x + 0.4, y + 0.4, W - 0.8, H - 0.8, 1.5, 1.5, "S");

    // Brand rule along the top edge.
    doc.setFillColor(...p.market);
    doc.rect(x + PAD, y + PAD, 10, 0.9, "F");

    // Name, two lines at most.
    doc.setFont(font, "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(...p.ink);
    const name = (doc.splitTextToSize(product.name, W - PAD * 2) as string[]).slice(0, 2);
    doc.text(name, x + PAD, y + PAD + 4.6);

    // Price, large.
    doc.setFontSize(19);
    doc.text(formatWhole(product.price), x + PAD, y + 21.5);
    doc.setFont(font, "normal");
    doc.setFontSize(6.8);
    doc.setTextColor(...p.ink70);
    doc.text(product.soldBy === "weight" ? `per ${product.unit} · weighed at the till` : `each · VAT inclusive`, x + PAD, y + 25);

    // Part number and print date.
    doc.setFont("courier", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(...p.ink);
    doc.text(product.sku, x + PAD, y + H - PAD - 0.6);
    doc.setFont(font, "normal");
    doc.setFontSize(5.5);
    doc.setTextColor(...p.ink40);
    doc.text(printedOn, x + PAD + 15, y + H - PAD - 0.6);

    // Barcode, bottom right.
    const code = product.barcodes[0] ? classifyBarcode(product.barcodes[0]).code : null;
    const modules = code ? ean13Modules(code) : null;
    const bw = 26;
    const bx = x + W - PAD - bw;
    const by = y + 13.5;
    if (modules && code) {
      const m = bw / 95;
      doc.setFillColor(...p.ink);
      let run = 0;
      for (let k = 0; k <= 95; k++) {
        if (k < 95 && modules[k] === "1") {
          run++;
          continue;
        }
        if (run) {
          const start = k - run;
          const guard = start < 3 || (start >= 45 && start < 50) || start >= 92;
          doc.rect(bx + start * m, by, run * m, guard ? 12 : 10.8, "F");
          run = 0;
        }
      }
      doc.setFont("courier", "normal");
      doc.setFontSize(6.5);
      doc.setTextColor(...p.ink);
      doc.text(code, bx + bw / 2, by + 14.6, { align: "center", charSpace: 0.35 });
    } else if (code) {
      doc.setFont("courier", "bold");
      doc.setFontSize(6.5);
      doc.setTextColor(...p.ink);
      doc.text(code, x + W - PAD, by + 14.6, { align: "right" });
    }
  });

  if (labels.length === 0) {
    doc.setFont(font, "normal");
    doc.setFontSize(11);
    doc.text("No labels requested.", 20, 30);
  }

  saveBlob(doc.output("blob"), `shelf-labels_${options.isoDay}.pdf`);
}
