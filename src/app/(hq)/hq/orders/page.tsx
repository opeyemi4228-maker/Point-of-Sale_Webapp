import type { Metadata } from "next";
import { OrdersScreen } from "@/components/purchasing/orders-screen";
import { WorkspaceHeader } from "@/components/shared/workspace-header";
import { todayInLagos } from "@/lib/utils/format-date";

export const metadata: Metadata = {
  title: "Purchase orders · Swiftgrocers POS",
};

/**
 * Purchase orders across the chain — SPEC §15.3. HQ sees every branch's
 * orders and can raise or receive one for a branch it picks.
 */
export default function HqOrdersPage() {
  return (
    <>
      <WorkspaceHeader title="Purchase orders" subtitle="On order and landed, across every branch" />
      <OrdersScreen today={todayInLagos()} />
    </>
  );
}
