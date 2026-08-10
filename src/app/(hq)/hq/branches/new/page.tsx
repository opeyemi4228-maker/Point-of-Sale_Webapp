import type { Metadata } from "next";
import { NewBranchWizard } from "@/components/hq/new-branch-wizard";
import { WorkspaceHeader } from "@/components/shared/workspace-header";

export const metadata: Metadata = {
  title: "New branch · Swiftgrocers POS",
};

/**
 * Branch provisioning — SPEC §4, §15.3.
 *
 * Admin only, and the only place in the system where a branch comes into
 * existence. Everything the new workspace needs is created in one transaction.
 */
export default function HqNewBranchPage() {
  return (
    <>
      <WorkspaceHeader
        title="Create a branch"
        subtitle="A sealed workspace, seeded and trading in about twenty seconds"
      />
      <NewBranchWizard />
    </>
  );
}
