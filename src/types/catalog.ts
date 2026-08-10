import type { Money } from "@/lib/domain/money";
import type { Quantity } from "@/lib/domain/quantity";
import type { SoldBy } from "./enums";

/**
 * A product in the master catalog — SPEC §7.3.
 *
 * Owned by HQ; branches hold stock of it but never edit it. Price lives here
 * because Swiftgrocers prices centrally — a branch override would be a separate
 * row against the branch, not a mutation of this one.
 */
export type Product = {
  id: string;
  /** Human-facing code on the shelf label, e.g. `SG-0417`. */
  sku: string;
  /**
   * Every barcode that resolves to this product. A grocery line routinely
   * carries several: the manufacturer's EAN-13, the case GTIN, and the
   * in-store QR the branch prints for loose goods. One product, many codes,
   * so this is a list and never a single field.
   */
  barcodes: string[];
  name: string;
  categoryId: string;
  categoryName: string;
  /** Unit price, VAT inclusive — SPEC §9.2. */
  price: Money;
  /** What the shop paid, for the margin figures. Never shown to a cashier. */
  cost: Money;
  soldBy: SoldBy;
  /** `ea`, `kg`, `L` — what the quantity counts. */
  unit: string;
  /** Below this, the branch is told to reorder — SPEC §10.4. */
  reorderLevel: Quantity;
  /**
   * Product photography, when there is any. Null is the normal case today —
   * the tile falls back to drawn category artwork rather than a grey box.
   */
  imageUrl: string | null;
  /** Soft delete only (CLAUDE.md rule 4). Delisted products still have history. */
  delistedAt: string | null;
};

/** A shelf grouping, used by the till's product grid when nothing is scanned. */
export type Category = {
  id: string;
  name: string;
  /** Ordering on the till grid — most-sold first, not alphabetical. */
  position: number;
};

/** What a scan resolved to, or why it did not. */
export type ScanResult =
  | { ok: true; product: Product }
  | { ok: false; code: "UNKNOWN_BARCODE" | "DELISTED"; barcode: string };
