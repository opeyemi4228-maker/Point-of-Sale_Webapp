import type { Metadata } from "next";
import { BranchLabel } from "@/components/shared/branch-label";
import { MovementsScreen } from "@/components/manager/movements-screen";
import { WorkspaceHeader } from "@/components/shared/workspace-header";

export const metadata: Metadata = {
  title: "Stock ledger · Swiftgrocers POS",
};

/** The raw ledger — SPEC §10.1. Where a manager goes when a figure looks wrong. */
export default function ManagerMovementsPage() {
  return (
    <>
      <WorkspaceHeader title="Stock ledger" subtitle={<BranchLabel suffix="every movement, newest first" />} />
      <MovementsScreen />
    </>
  );
}
