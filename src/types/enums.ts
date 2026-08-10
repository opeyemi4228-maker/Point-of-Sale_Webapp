/**
 * Domain enumerations, lifted verbatim from the PostgreSQL types in SPEC §7.
 * These are stable; entity interfaces are generated from the schema later and
 * live alongside this file.
 */

export type BranchStatus = "provisioning" | "active" | "suspended" | "closed";

export type StaffRole = "general_admin" | "branch_manager" | "sales_person";
export type StaffStatus = "invited" | "active" | "suspended" | "offboarded";

export type ShiftStatus = "open" | "closed" | "force_closed";

export type SoldBy = "unit" | "weight";

export type StockReason =
  | "BRANCH_OPENED"
  | "SALE"
  | "REFUND"
  | "VOID"
  | "PURCHASE_RECEIPT"
  | "TRANSFER_OUT"
  | "TRANSFER_IN"
  | "COUNT_ADJUSTMENT"
  | "DAMAGE"
  | "EXPIRY"
  | "THEFT"
  | "SAMPLE"
  | "CORRECTION"
  /** Picked for an online order. The storefront draws on the same ledger. */
  | "ONLINE_ORDER"
  | "ONLINE_RETURN";

export type SaleStatus =
  | "draft"
  | "completed"
  | "voided"
  | "refunded"
  | "partially_refunded";

export type PaymentMethod =
  | "cash"
  | "card"
  | "transfer"
  | "pos_terminal"
  | "loyalty_points"
  | "split"
  | "credit";

export type LoyaltyReason =
  | "EARN"
  | "REDEEM"
  | "REVERSAL"
  | "EXPIRY"
  | "MANUAL_ADJUST"
  | "SIGNUP_BONUS"
  | "BIRTHDAY_BONUS"
  | "PROMOTION";

export type LoyaltyTier = "bronze" | "silver" | "gold";

export type PoStatus =
  | "draft"
  | "sent"
  | "partially_received"
  | "received"
  | "cancelled";

export type TransferStatus =
  | "requested"
  | "approved"
  | "in_transit"
  | "received"
  | "rejected"
  | "cancelled";

export type CountStatus = "open" | "counting" | "review" | "posted" | "abandoned";

export type ApprovalStatus = "pending" | "approved" | "denied" | "expired";

/** Actions that a cashier may trigger but a manager must clear — SPEC §3. */
export type ApprovalAction =
  | "PRICE_OVERRIDE"
  | "VOID_SALE"
  | "REFUND"
  | "POST_COUNT"
  | "OVERSELL"
  | "POINTS_ADJUST";

/** Sync engine — SPEC §10. */
export type OutboxState = "pending" | "in_flight" | "synced" | "failed";
export type SyncEntity =
  | "sale"
  | "refund"
  | "stock_ledger"
  | "shift"
  | "loyalty"
  | "count_line";
