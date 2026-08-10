import type { Metadata } from "next";
import { BranchLabel } from "@/components/shared/branch-label";
import { MovementsScreen } from "@/components/manager/movements-screen";
import { WorkspaceHeader } from "@/components/shared/workspace-header";

export const metadata: Metadata = { title: "Stock movements · Swiftgrocers POS" };

/**
 * The ledger, read straight — SPEC §10.1.
 *
 * Filed under Counts because a count is the reason a manager opens it: they
 * have a number that disagrees with the shelf and need the movements behind it.
 */
export default function ManagerCountsPage() {
  return (
    <>
      <WorkspaceHeader
        title="Stock movements"
        subtitle={<BranchLabel suffix="every change, newest first" />}
      />
      <MovementsScreen />
    </>
  );
}
