import type { Metadata } from "next";
import { DeliveriesScreen } from "@/components/inventory/deliveries-screen";
import { WorkspaceHeader } from "@/components/shared/workspace-header";
import { todayInLagos } from "@/lib/utils/format-date";

export const metadata: Metadata = {
  title: "Deliveries · Swiftgrocers POS",
};

/**
 * Deliveries — SPEC §10, §15.3. A thin shell: the screen reads the
 * ledger and the session itself, and HQ picks the branch on it.
 * The day is resolved here, once, so server and client agree on "today".
 */
export default function Page() {
  return (
    <>
      <WorkspaceHeader title="Deliveries" subtitle={"Purchases from the warehouse and suppliers, by branch"} />
      <DeliveriesScreen today={todayInLagos()} />
    </>
  );
}
