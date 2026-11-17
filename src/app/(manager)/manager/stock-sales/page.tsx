import type { Metadata } from "next";
import { BranchLabel } from "@/components/shared/branch-label";
import { StockSalesScreen } from "@/components/inventory/stock-sales-screen";
import { WorkspaceHeader } from "@/components/shared/workspace-header";
import { todayInLagos } from "@/lib/utils/format-date";

export const metadata: Metadata = {
  title: "Stock & sales · Swiftgrocers POS",
};

/**
 * Stock & sales — SPEC §10, §15.2. A thin shell: the screen reads the
 * ledger and the session itself.
 * The day is resolved here, once, so server and client agree on "today".
 */
export default function Page() {
  return (
    <>
      <WorkspaceHeader title="Stock & sales" subtitle={<BranchLabel suffix="takings and stock reconciliation" />} />
      <StockSalesScreen today={todayInLagos()} />
    </>
  );
}
