/**
 * Report export — the CSV rendering of a `ReportSpec`.
 *
 *   npm run test:domain
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { moneyCell, qtyCell, reportFilename, toCsv } from "../../src/lib/export/report.ts";
import { naira } from "../../src/lib/domain/money.ts";
import { units } from "../../src/lib/domain/quantity.ts";

const spec = (rows, extra = {}) => ({
  title: "Stock on hand",
  filename: "x",
  tables: [{ columns: [{ header: "Part no." }, { header: "Barcode" }, { header: "On hand" }, { header: "Value" }], rows }],
  ...extra,
});

test("money and quantity go out raw so a spreadsheet can sum them", () => {
  const csv = toCsv(spec([["SG-0112", "6154000016678", qtyCell(units(-2), "ea"), moneyCell(naira(-12_600))]]));
  const [header, row] = csv.replace("﻿", "").trim().split("\r\n");
  assert.equal(header, "Part no.,Barcode,On hand,Value");
  // Barcode protected from Excel's scientific notation; figures bare.
  assert.equal(row, 'SG-0112,="6154000016678",-2,-12600');
});

test("starts with a BOM so Excel reads UTF-8", () => {
  assert.ok(toCsv(spec([])).startsWith("﻿"));
});

test("quotes commas, quotes and newlines", () => {
  const csv = toCsv(spec([['Eggs, "large"', "a\nb", "", ""]]));
  assert.match(csv, /"Eggs, ""large""","a\nb",,/);
});

test("several tables are separated by their headings", () => {
  const csv = toCsv({
    title: "t",
    filename: "x",
    tables: [
      { heading: "First", columns: [{ header: "A" }], rows: [["1"]] },
      { heading: "Second", columns: [{ header: "B" }], rows: [["2"]], totals: ["3"] },
    ],
  });
  assert.equal(csv.replace("﻿", ""), "First\r\nA\r\n1\r\n\r\nSecond\r\nB\r\n2\r\n3\r\n");
});

test("file names are safe everywhere", () => {
  assert.equal(reportFilename("Stock on hand", "GWA", null, "2026-11-17"), "stock-on-hand_gwa_2026-11-17");
});
