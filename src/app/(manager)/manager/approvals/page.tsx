import type { Metadata } from "next";
import { ApprovalsScreen } from "@/components/manager/approvals-screen";
import { BranchLabel } from "@/components/shared/branch-label";
import { WorkspaceHeader } from "@/components/shared/workspace-header";

export const metadata: Metadata = {
  title: "Approvals · Swiftgrocers POS",
};

export default function ManagerApprovalsPage() {
  return (
    <>
      <WorkspaceHeader
        title="Approvals"
        subtitle={<BranchLabel suffix="refunds, voids, overrides and count variances" />}
      />
      <ApprovalsScreen />
    </>
  );
}
