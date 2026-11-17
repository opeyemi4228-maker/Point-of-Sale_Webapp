import type { Money } from "@/lib/domain/money";
import type { Quantity } from "@/lib/domain/quantity";

/** An action a cashier may take only with a manager's approval — SPEC §3. */
export type Approval = {
  id: string;
  kind: "price_override" | "void_sale" | "refund" | "post_count";
  /** What is actually being asked for, in the cashier's words. */
  summary: string;
  detail: string;
  amount: Money | null;
  requestedBy: string;
  requestedAt: string;
  status: "pending" | "approved" | "denied";
};

/** A stock count — SPEC §9.6. */
export type StockCount = {
  id: string;
  reference: string;
  scope: "full" | "category" | "cycle";
  scopeLabel: string;
  status: "open" | "counting" | "review" | "posted";
  startedBy: string;
  startedAt: string;
  linesTotal: number;
  linesCounted: number;
  varianceValue: Money;
};

/** An inter-branch stock movement — SPEC §7.7. */
export type Transfer = {
  id: string;
  reference: string;
  fromBranchId: string;
  toBranchId: string;
  status: "requested" | "approved" | "in_transit" | "received" | "rejected";
  lines: number;
  totalQty: Quantity;
  value: Money;
  requestedBy: string;
  requestedAt: string;
};

/**
 * A purchase order to the warehouse or a supplier — SPEC §7.7.
 *
 * Records what was *asked for*. What actually arrived is never stored here: it
 * is the `PURCHASE_RECEIPT` movements whose `orderRef` is this order's
 * reference, so the order and the stock ledger cannot disagree about how much
 * landed (CLAUDE.md rule 3). Status follows from the same rows — see
 * `orderProgress` in `lib/domain/purchasing.ts`.
 *
 * Never deleted (rule 4). A draft that is no longer wanted is cancelled, with
 * a reason, and stays on the list.
 */
export type PurchaseOrder = {
  id: string;
  /** `PO-GWA-0120` — what is written on the supplier's paperwork. */
  reference: string;
  branchId: string;
  supplier: string;
  supplierKind: "warehouse" | "supplier";
  lines: PurchaseOrderLine[];
  /** Lagos calendar day the delivery is promised for. */
  expectedOn: string | null;
  note: string | null;
  createdAt: string;
  createdBy: string;
  /** Null while a draft. */
  sentAt: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
};

export type PurchaseOrderLine = {
  productId: string;
  quantity: Quantity;
  /** Agreed price per unit. What was actually paid is on each receipt. */
  unitCost: Money;
};

/** One thing that happened to an order — the trail shown under it. */
export type PurchaseOrderEvent = {
  orderId: string;
  action: "raised" | "edited" | "sent" | "cancelled";
  at: string;
  by: string;
  detail?: string;
};

/** A registered till — SPEC §7.2, §16 admin. */
export type Device = {
  id: string;
  label: string;
  deviceCode: string;
  branchId: string;
  appVersion: string;
  lastSeenAt: string;
  /** Minutes of clock drift from the server. Beyond 5 raises a health alert. */
  clockSkewMinutes: number;
  queuedWrites: number;
  online: boolean;
};

/** An immutable record of a privileged action — SPEC §7.8. */
export type AuditEntry = {
  id: string;
  action: string;
  actorName: string;
  actorRole: string;
  branchId: string | null;
  entity: string;
  occurredAt: string;
  detail: string;
};

/** What the create-a-branch wizard collects — SPEC §4, §15.3. */
export type NewBranch = {
  name: string;
  code: string;
  city: string;
  state: string;
  address: string;
  phone: string;
  openingFloat: string;
  lowStockThreshold: string;
  managerName: string;
  managerEmail: string;
  managerPhone: string;
  catalogMode: "full" | "none";
  tills: string;
};
