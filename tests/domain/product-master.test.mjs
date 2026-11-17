/**
 * Product master — SPEC §7.3. Identifiers, margins and catalog health.
 *
 *   npm run test:domain
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  catalogIssues,
  classifyBarcode,
  ean13Modules,
  formatBasisPoints,
  gtinCheckDigitValid,
  marginBasisPoints,
  searchMaster,
} from "../../src/lib/domain/product-master.ts";
import { naira } from "../../src/lib/domain/money.ts";
import { units } from "../../src/lib/domain/quantity.ts";

const product = (overrides = {}) => ({
  id: "p1",
  sku: "SG-0001",
  barcodes: ["6151000000010"],
  name: "Mama Gold Rice 5kg",
  categoryId: "c1",
  categoryName: "Staples",
  price: naira(9_800),
  cost: naira(8_150),
  soldBy: "unit",
  unit: "ea",
  reorderLevel: units(12),
  imageUrl: null,
  delistedAt: null,
  ...overrides,
});

test("GS1 check digit holds for EAN-13, UPC-A and EAN-8", () => {
  assert.equal(gtinCheckDigitValid("4006381333931"), true); // EAN-13
  assert.equal(gtinCheckDigitValid("4006381333932"), false);
  assert.equal(gtinCheckDigitValid("036000291452"), true); // UPC-A
  assert.equal(gtinCheckDigitValid("96385074"), true); // EAN-8
  assert.equal(gtinCheckDigitValid("SG-0001"), false);
});

test("classifies codes and reads the GS1 origin", () => {
  const nigerian = classifyBarcode("6154000016678", true);
  assert.equal(nigerian.kind, "ean13");
  assert.equal(nigerian.origin, "Nigeria");
  assert.equal(nigerian.primary, true);

  assert.equal(classifyBarcode(" sg-qr-beans-kg ").kind, "in_store");
  assert.equal(classifyBarcode("SG-QR-BEANS-KG").valid, null);
  assert.equal(classifyBarcode("036000291452").kind, "upca");
  assert.equal(classifyBarcode("0012345678905").origin, "USA / Canada");
});

test("EAN-13 modules: 95 wide, guard bars in place, refuses a bad code", () => {
  const bars = ean13Modules("4006381333931");
  assert.equal(bars.length, 95);
  assert.equal(bars.slice(0, 3), "101");
  assert.equal(bars.slice(45, 50), "01010");
  assert.equal(bars.slice(92), "101");
  // First digit 4 → parity LGLLGG; digit 1 (0) encoded in L.
  assert.equal(bars.slice(3, 10), "0001101");
  assert.equal(ean13Modules("4006381333932"), null);
  assert.equal(ean13Modules("SG-0001"), null);
});

test("margin is integer basis points of the selling price", () => {
  assert.equal(marginBasisPoints(naira(100), naira(85)), 1_500);
  assert.equal(marginBasisPoints(naira(9_800), naira(8_150)), 1_684);
  assert.equal(marginBasisPoints(naira(0), naira(5)), null);
  assert.equal(formatBasisPoints(1_500), "15%");
  assert.equal(formatBasisPoints(1_684), "16.8%");
  assert.equal(formatBasisPoints(null), "—");
});

test("catalog health finds the records that will cause trouble", () => {
  const issues = catalogIssues([
    product(),
    product({ id: "p2", sku: "SG-0002", barcodes: [] }),
    product({ id: "p3", sku: "SG-0003", barcodes: ["6151000000010"] }),
    product({ id: "p4", sku: "SG-0004", barcodes: ["4006381333932"] }),
    product({ id: "p5", sku: "SG-0005", barcodes: ["96385074"], price: naira(100), cost: naira(120) }),
    product({ id: "p6", sku: "SG-0006", barcodes: ["036000291452"], reorderLevel: units(0) }),
    product({ id: "p7", sku: "SG-0007", barcodes: [], delistedAt: "2026-01-01T00:00:00Z" }),
  ]);

  const codes = (id) => (issues.get(id) ?? []).map((i) => i.code);
  assert.deepEqual(codes("p1"), ["DUPLICATE_BARCODE"]);
  assert.deepEqual(codes("p2"), ["NO_BARCODE"]);
  assert.deepEqual(codes("p3"), ["DUPLICATE_BARCODE"]);
  assert.match(issues.get("p3")[0].message, /SG-0001/);
  assert.deepEqual(codes("p4"), ["BAD_CHECK_DIGIT"]);
  assert.deepEqual(codes("p5"), ["BELOW_COST"]);
  assert.deepEqual(codes("p6"), ["NO_REORDER_LEVEL"]);
  // Delisted lines are not nagged about.
  assert.equal(issues.has("p7"), false);
});

test("master search matches name, part number, category and any barcode", () => {
  const list = [product(), product({ id: "p2", sku: "SG-0112", name: "Devon King's Oil 3L", barcodes: ["6154000016678"] })];
  assert.deepEqual(searchMaster(list, "6154000016678").map((p) => p.id), ["p2"]);
  assert.deepEqual(searchMaster(list, "sg-0112").map((p) => p.id), ["p2"]);
  assert.deepEqual(searchMaster(list, "staples rice").map((p) => p.id), ["p1"]);
  assert.equal(searchMaster(list, "").length, 2);
});
