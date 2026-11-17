import type { Metadata } from "next";
import { StockSalesScreen } from "@/components/inventory/stock-sales-screen";
import { WorkspaceHeader } from "@/components/shared/workspace-header";
import { todayInLagos } from "@/lib/utils/format-date";

export const metadata: Metadata = {
  title: "Stock & sales · Swiftgrocers POS",
};

/**
 * Stock & sales — SPEC §10, §15.3. A thin shell: the screen reads the
 * ledger and the session itself, and HQ picks the branch on it.
 * The day is resolved here, once, so server and client agree on "today".
 */
export default function Page() {
  return (
    <>
      <WorkspaceHeader title="Stock & sales" subtitle={"Takings and stock reconciliation across the chain"} />
      <StockSalesScreen today={todayInLagos()} />
    </>
  );
}
