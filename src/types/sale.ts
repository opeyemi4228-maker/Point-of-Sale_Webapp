import type { Money } from "@/lib/domain/money";
import type { Quantity } from "@/lib/domain/quantity";
import type { PaymentMethod, SaleStatus, SoldBy } from "./enums";

/**
 * A completed sale — SPEC §11.
 *
 * The record the receipt is printed from and the reason stock moved. Written
 * once at the till and never edited: a mistake is reversed with a refund or a
 * void, both of which are their own records (CLAUDE.md rule 4). Everything is
 * `readonly` so nothing downstream can quietly adjust a line after the customer
 * has walked out with the receipt.
 *
 * Line prices are copied, not referenced. A price change tomorrow must not
 * silently restate what a customer paid today.
 */
export type SaleLine = {
  readonly productId: string;
  readonly name: string;
  readonly sku: string;
  readonly quantity: Quantity;
  /**
   * Carried on the line, not looked up from the catalog later.
   *
   * Without it a receipt cannot count itself: adding a quantity of `each` to a
   * quantity of `kilograms` gives a number in no unit at all, which is how one
   * pack of spaghetti and 5kg of beans printed as "6 items".
   */
  readonly soldBy: SoldBy;
  readonly unit: string;
  readonly unitPrice: Money;
  readonly discount: Money;
  /** The rounded line total, stored so the receipt and the report agree forever. */
  readonly lineTotal: Money;
};

export type Tender = {
  readonly method: PaymentMethod;
  readonly amount: Money;
};

export type Sale = {
  readonly id: string;
  /** Printed on the receipt, e.g. `SG-GWA-20260728-0042` — SPEC §12. */
  readonly receiptNo: string;
  readonly branchId: string;
  readonly branchName: string;
  readonly staffId: string;
  readonly staffName: string;
  readonly staffCode: string;

  /**
   * The loyalty member this was rung against — SPEC §11.
   *
   * Null is the ordinary case and is not a gap. Asking for a phone number is
   * offered at every sale and compulsory at none: a queue moves faster than a
   * scheme, and a cashier who has to ask before they can settle will start
   * keying their own number to get past the prompt.
   */
  readonly customerId: string | null;
  /** Copied, like every other name here, so the receipt still reads in a year. */
  readonly customerName: string | null;
  /** Points this sale earned. Zero when no card was given. */
  readonly pointsEarned: number;
  /**
   * Points spent on this sale. The money they took off is carried as a
   * `loyalty_points` tender, so the receipt adds up without special cases.
   */
  readonly pointsRedeemed: number;

  readonly lines: readonly SaleLine[];
  readonly subtotal: Money;
  readonly discount: Money;
  readonly total: Money;
  readonly tenders: readonly Tender[];
  /** Cash given back. Zero for card and transfer. */
  readonly change: Money;
  readonly status: SaleStatus;
  /** ISO instant, UTC. Formatted to Lagos at the presentation layer only. */
  readonly at: string;
  /**
   * Whether the till had a connection when this was rung.
   *
   * Not an error flag. Offline is a normal way for this shop to trade (rule 8);
   * this exists so a manager can tell a genuine oversell from a sync artefact,
   * and so the sync queue knows what it still owes the server.
   */
  readonly takenOffline: boolean;
  readonly syncedAt: string | null;
};

/** A cashier's session at a till — SPEC §11.4. */
export type Shift = {
  readonly id: string;
  readonly branchId: string;
  readonly staffId: string;
  readonly staffName: string;
  readonly tillLabel: string;
  readonly openedAt: string;
  readonly openingFloat: Money;
  readonly closedAt: string | null;
  /** What the cashier counted at close. Null until they do. */
  readonly countedCash: Money | null;
  readonly status: "open" | "closed";
};
