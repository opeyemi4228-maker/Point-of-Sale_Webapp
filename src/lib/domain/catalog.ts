import type { Product, ScanResult } from "@/types/catalog";

/**
 * Catalog lookup — SPEC §7.3, §15.1.
 *
 * Pure. No I/O, no clock, no React.
 */

/**
 * Put a scanned code into the one form the catalog is indexed by.
 *
 * Hardware scanners are messy in ways that matter at 08:00 with a queue: a
 * keyboard wedge can emit a trailing Enter or a stray tab, a QR label printed
 * in the back office may carry surrounding whitespace, and some scanners send
 * lowercase for alphanumeric codes. None of that changes which product the
 * customer is holding, so it is normalised away rather than treated as a miss.
 *
 * What is *not* normalised: leading zeroes. `0123` and `123` are different
 * GTINs, and quietly trimming them would sell the wrong product.
 */
export function normaliseBarcode(raw: string): string {
  return raw.trim().replace(/\s+/g, "").toUpperCase();
}

/**
 * EAN-13 check digit — SPEC §10.2.
 *
 * Worth doing on a manually keyed code, where a transposed digit is common and
 * would otherwise resolve to a real but wrong product. Not worth blocking a
 * scanner on: the hardware has already validated it, and a false rejection at
 * the till costs more than it saves. Returns `null` when the code is not a
 * 13-digit numeric at all, so callers can tell "not applicable" from "failed".
 */
export function isValidEan13(barcode: string): boolean | null {
  if (!/^\d{13}$/.test(barcode)) return null;

  const digits = [...barcode].map(Number);
  const checkDigit = digits[12];
  const weighted = digits
    .slice(0, 12)
    .reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 1 : 3), 0);

  return (10 - (weighted % 10)) % 10 === checkDigit;
}

/**
 * Index a catalog by every barcode each product carries.
 *
 * Built once per catalog rather than scanned linearly per keystroke: the till
 * resolves a code on every scan and a 4,000-line catalog would be a visible
 * stall on the shop-floor hardware Swiftgrocers actually runs.
 */
export function indexByBarcode(products: readonly Product[]): Map<string, Product> {
  const index = new Map<string, Product>();
  for (const product of products) {
    for (const barcode of product.barcodes) {
      index.set(normaliseBarcode(barcode), product);
    }
  }
  return index;
}

/** Resolve a scanned or keyed code against a prepared index. */
export function resolveBarcode(
  index: ReadonlyMap<string, Product>,
  raw: string,
): ScanResult {
  const barcode = normaliseBarcode(raw);
  const product = index.get(barcode);

  if (!product) return { ok: false, code: "UNKNOWN_BARCODE", barcode };

  // A delisted product is a deliberate refusal, not a miss. Selling it would
  // move stock the chain has stopped buying, and the cashier needs to know the
  // difference between "no such code" and "we do not sell this any more".
  if (product.delistedAt) return { ok: false, code: "DELISTED", barcode };

  return { ok: true, product };
}

/**
 * Free-text search for the till's grid — name and SKU, case-insensitive.
 *
 * Every term must match somewhere, so "peak 400" finds Peak Milk 400g while
 * "peak rice" finds nothing. That is the behaviour a cashier expects from
 * typing more words: narrower, not broader.
 */
export function searchProducts(
  products: readonly Product[],
  query: string,
): Product[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...products];

  return products.filter((product) => {
    const haystack = `${product.name} ${product.sku}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

/** Live products only. Delisted lines stay in history but leave the grid. */
export const listed = (products: readonly Product[]): Product[] =>
  products.filter((product) => !product.delistedAt);
