import type { Metadata } from "next";
import { BranchLabel } from "@/components/shared/branch-label";
import { DeliveriesScreen } from "@/components/inventory/deliveries-screen";
import { WorkspaceHeader } from "@/components/shared/workspace-header";
import { todayInLagos } from "@/lib/utils/format-date";

export const metadata: Metadata = {
  title: "Deliveries · Swiftgrocers POS",
};

/**
 * Deliveries — SPEC §10, §15.2. A thin shell: the screen reads the
 * ledger and the session itself.
 * The day is resolved here, once, so server and client agree on "today".
 */
export default function Page() {
  return (
    <>
      <WorkspaceHeader title="Deliveries" subtitle={<BranchLabel suffix="purchases from the warehouse and suppliers" />} />
      <DeliveriesScreen today={todayInLagos()} />
    </>
  );
}
