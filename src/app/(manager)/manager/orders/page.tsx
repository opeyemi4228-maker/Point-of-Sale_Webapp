import type { Metadata } from "next";
import { BranchLabel } from "@/components/shared/branch-label";
import { OrdersScreen } from "@/components/purchasing/orders-screen";
import { WorkspaceHeader } from "@/components/shared/workspace-header";
import { todayInLagos } from "@/lib/utils/format-date";

export const metadata: Metadata = {
  title: "Purchase orders · Swiftgrocers POS",
};

/**
 * Purchase orders — SPEC §7.7.
 *
 * Receiving against an order is what writes `PURCHASE_RECEIPT` movements into
 * the ledger; the order itself moves no stock. That separation is why a delivery
 * that arrives short is visible as a difference between ordered and received
 * rather than disappearing into a corrected balance.
 */
export default function ManagerOrdersPage() {
  return (
    <>
      <WorkspaceHeader
        title="Purchase orders"
        subtitle={<BranchLabel suffix="what is on order and what has landed" />}
      />
      <OrdersScreen today={todayInLagos()} />
    </>
  );
}
