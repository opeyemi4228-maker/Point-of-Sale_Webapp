import { normaliseBarcode } from "./catalog";
import type { Money } from "./money";
import type { Product } from "@/types/catalog";

/**
 * The product master — SPEC §7.3.
 *
 * What a product *is*, as opposed to how much of it a branch holds. Every line
 * carries three kinds of identifier, and the product database screen exists to
 * keep them straight:
 *
 * - **Part number** — the SKU, `SG-0112`. Ours, unique, never reused, printed on
 *   the shelf label. Every product has exactly one; it is how a person refers to
 *   a line on the phone, on a count sheet or on a purchase order, and it is the
 *   one identifier that survives a manufacturer changing its packaging.
 * - **Barcodes** — the codes a scanner reads. A product has *any number*: the
 *   manufacturer's EAN-13, a case GTIN, the in-store label the branch prints for
 *   loose goods. Barcodes identify packaging; the part number identifies the
 *   product.
 * - **The database id** — internal, never shown.
 *
 * Pure. No I/O, no clock, no React.
 */

/* ── Barcodes ─────────────────────────────────────────────────────────────── */

export type BarcodeKind = "ean13" | "ean8" | "upca" | "in_store" | "other";

export type BarcodeInfo = {
  code: string;
  kind: BarcodeKind;
  /** "EAN-13", "In-store label". */
  label: string;
  /** Check digit result. `null` when the symbology has none to check. */
  valid: boolean | null;
  /** Where a GS1 prefix says the code was issued — "Nigeria" for 615. */
  origin: string | null;
  /** The first code on a product is the one printed on its shelf label. */
  primary: boolean;
};

/**
 * GS1 mod-10 check, shared by EAN-13, EAN-8 and UPC-A.
 *
 * Weights alternate 3, 1 from the digit nearest the check digit leftwards,
 * which is why the same function serves every length.
 */
export function gtinCheckDigitValid(code: string): boolean {
  if (!/^\d{8,14}$/.test(code)) return false;
  const digits = [...code].map(Number);
  const check = digits.pop()!;
  const total = digits
    .reverse()
    .reduce((sum, digit, i) => sum + digit * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (total % 10)) % 10 === check;
}

/**
 * GS1 company prefixes for the origins a Nigerian grocer actually sees.
 * Not exhaustive and not meant to be — a code outside it simply has no origin.
 */
const GS1_PREFIXES: { from: number; to: number; origin: string }[] = [
  { from: 0, to: 139, origin: "USA / Canada" },
  { from: 200, to: 299, origin: "In-store (restricted)" },
  { from: 300, to: 379, origin: "France" },
  { from: 400, to: 440, origin: "Germany" },
  { from: 500, to: 509, origin: "United Kingdom" },
  { from: 600, to: 601, origin: "South Africa" },
  { from: 603, to: 603, origin: "Ghana" },
  { from: 615, to: 615, origin: "Nigeria" },
  { from: 616, to: 616, origin: "Kenya" },
  { from: 622, to: 622, origin: "Egypt" },
  { from: 690, to: 699, origin: "China" },
  { from: 750, to: 750, origin: "Mexico" },
  { from: 760, to: 769, origin: "Switzerland" },
  { from: 789, to: 790, origin: "Brazil" },
  { from: 800, to: 839, origin: "Italy" },
  { from: 840, to: 849, origin: "Spain" },
  { from: 870, to: 879, origin: "Netherlands" },
  { from: 890, to: 890, origin: "India" },
  { from: 955, to: 955, origin: "Malaysia" },
];

function originOf(ean13: string): string | null {
  const prefix = Number(ean13.slice(0, 3));
  const hit = GS1_PREFIXES.find((p) => prefix >= p.from && prefix <= p.to);
  return hit?.origin ?? null;
}

export function classifyBarcode(raw: string, primary = false): BarcodeInfo {
  const code = normaliseBarcode(raw);

  if (/^\d{13}$/.test(code)) {
    return { code, kind: "ean13", label: "EAN-13", valid: gtinCheckDigitValid(code), origin: originOf(code), primary };
  }
  if (/^\d{12}$/.test(code)) {
    return { code, kind: "upca", label: "UPC-A", valid: gtinCheckDigitValid(code), origin: "USA / Canada", primary };
  }
  if (/^\d{8}$/.test(code)) {
    return { code, kind: "ean8", label: "EAN-8", valid: gtinCheckDigitValid(code), origin: null, primary };
  }
  // The branch's own labels — `SG-QR-BEANS-KG` — printed at the scale for
  // goods that arrive without a manufacturer code.
  if (/^SG-/.test(code)) {
    return { code, kind: "in_store", label: "In-store label", valid: null, origin: "Swiftgrocers", primary };
  }
  return { code, kind: "other", label: "Other code", valid: null, origin: null, primary };
}

export const barcodesOf = (product: Pick<Product, "barcodes">): BarcodeInfo[] =>
  product.barcodes.map((code, i) => classifyBarcode(code, i === 0));

/* ── EAN-13 drawing ───────────────────────────────────────────────────────── */

/** Odd-parity (L) patterns. R is L inverted; G is R reversed. */
const L_CODES = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const R_CODES = L_CODES.map((c) => [...c].map((b) => (b === "0" ? "1" : "0")).join(""));
const G_CODES = R_CODES.map((c) => [...c].reverse().join(""));
/** Which of the six left digits use G, keyed by the first (implied) digit. */
const PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];

/**
 * The 95 modules of an EAN-13 symbol, `1` for a bar and `0` for a space —
 * enough to draw a scannable code as SVG without a barcode library.
 *
 * Returns null for anything that is not a 13-digit code with a valid check
 * digit: drawing a code that fails its own checksum would print a label no
 * scanner will accept.
 */
export function ean13Modules(code: string): string | null {
  if (!/^\d{13}$/.test(code) || !gtinCheckDigitValid(code)) return null;
  const d = [...code].map(Number);
  const parity = PARITY[d[0]];
  let out = "101";
  for (let i = 1; i <= 6; i++) out += (parity[i - 1] === "L" ? L_CODES : G_CODES)[d[i]];
  out += "01010";
  for (let i = 7; i <= 12; i++) out += R_CODES[d[i]];
  return `${out}101`;
}

/* ── Pricing ──────────────────────────────────────────────────────────────── */

/**
 * Gross margin as basis points of the selling price: 1_550 is 15.50%.
 *
 * Integer on purpose — the ratio is computed once from integer kobo and never
 * carried as a float that could drift into a money figure. Null when the price
 * is zero, where margin has no meaning.
 */
export function marginBasisPoints(price: Money, cost: Money): number | null {
  if (price.kobo <= 0) return null;
  return Math.round(((price.kobo - cost.kobo) * 10_000) / price.kobo);
}

/** `15.5%`, or an em dash where there is no margin to show. */
export function formatBasisPoints(bp: number | null): string {
  if (bp === null) return "—";
  const percent = bp / 100;
  return `${Number.isInteger(percent) ? percent.toFixed(0) : percent.toFixed(1)}%`;
}

/* ── Catalog health ───────────────────────────────────────────────────────── */

export type CatalogIssueCode =
  | "NO_BARCODE"
  | "BAD_CHECK_DIGIT"
  | "DUPLICATE_BARCODE"
  | "BELOW_COST"
  | "NO_COST"
  | "NO_REORDER_LEVEL";

export type CatalogIssue = { code: CatalogIssueCode; message: string };

/**
 * What is wrong with each product record, keyed by product id.
 *
 * Every one of these turns into a real problem on the shop floor: a line with
 * no barcode has to be found by name at the till; a bad check digit was keyed
 * by hand and will never scan; a barcode shared by two products sells the
 * wrong one; a price under cost loses money on every sale; and a line with no
 * reorder level never asks to be reordered.
 *
 * Delisted products are not checked — they no longer sell — but their codes
 * still count towards duplicates, because a delisted product's barcode
 * resolves to a refusal at the till and would shadow a live one.
 */
export function catalogIssues(products: readonly Product[]): Map<string, CatalogIssue[]> {
  const owners = new Map<string, Set<string>>();
  for (const product of products) {
    for (const raw of product.barcodes) {
      const code = normaliseBarcode(raw);
      const set = owners.get(code) ?? new Set<string>();
      set.add(product.id);
      owners.set(code, set);
    }
  }
  const skuOf = new Map(products.map((p) => [p.id, p.sku]));

  const issues = new Map<string, CatalogIssue[]>();
  for (const product of products) {
    if (product.delistedAt) continue;
    const list: CatalogIssue[] = [];

    if (product.barcodes.length === 0) {
      list.push({ code: "NO_BARCODE", message: "No barcode — it can only be found by name at the till." });
    }
    for (const info of barcodesOf(product)) {
      if (info.valid === false) {
        list.push({ code: "BAD_CHECK_DIGIT", message: `${info.code} fails its ${info.label} check digit — likely mistyped.` });
      }
      const shared = [...(owners.get(info.code) ?? [])].filter((id) => id !== product.id);
      if (shared.length) {
        list.push({
          code: "DUPLICATE_BARCODE",
          message: `${info.code} is also on ${shared.map((id) => skuOf.get(id) ?? id).join(", ")}.`,
        });
      }
    }
    if (product.cost.kobo <= 0) {
      list.push({ code: "NO_COST", message: "No cost price — margin and stock value read as zero." });
    } else if (product.price.kobo <= product.cost.kobo) {
      list.push({ code: "BELOW_COST", message: "Sells at or below cost." });
    }
    if (product.reorderLevel.milli <= 0) {
      list.push({ code: "NO_REORDER_LEVEL", message: "No reorder level — it will never be flagged as low." });
    }

    if (list.length) issues.set(product.id, list);
  }
  return issues;
}

/* ── Search ───────────────────────────────────────────────────────────────── */

/**
 * Search the product master by name, part number, category or any barcode.
 *
 * Wider than the till's `searchProducts`: in the back office people look a
 * product up by the code printed on a supplier's invoice as often as by name.
 * Every term must match somewhere, so typing more narrows the list.
 */
export function searchMaster(products: readonly Product[], query: string): Product[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...products];
  return products.filter((product) => {
    const haystack = `${product.name} ${product.sku} ${product.categoryName} ${product.barcodes.join(" ")}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}
