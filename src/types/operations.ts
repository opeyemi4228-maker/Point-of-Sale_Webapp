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

/** A purchase order to a supplier — SPEC §7.7. */
export type PurchaseOrder = {
  id: string;
  reference: string;
  supplier: string;
  status: "draft" | "sent" | "partially_received" | "received" | "cancelled";
  lines: number;
  total: Money;
  expectedOn: string | null;
  createdAt: string;
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
