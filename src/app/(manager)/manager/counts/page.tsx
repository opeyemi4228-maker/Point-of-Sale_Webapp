import type { Metadata } from "next";
import { BranchLabel } from "@/components/shared/branch-label";
import { CountsScreen } from "@/components/counts/counts-screen";
import { WorkspaceHeader } from "@/components/shared/workspace-header";
import { todayInLagos } from "@/lib/utils/format-date";

export const metadata: Metadata = { title: "Stock counts · Swiftgrocers POS" };

/**
 * Stock counts — SPEC §10.3. Cycle counts, category counts and the full
 * stock-take; variances post to the ledger as count adjustments.
 */
export default function ManagerCountsPage() {
  return (
    <>
      <WorkspaceHeader title="Stock counts" subtitle={<BranchLabel suffix="cycle counts and stock-takes" />} />
      <CountsScreen today={todayInLagos()} />
    </>
  );
}
