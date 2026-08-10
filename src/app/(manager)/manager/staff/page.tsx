import type { Metadata } from "next";
import { BranchLabel } from "@/components/shared/branch-label";
import { StaffScreenContainer } from "@/components/manager/staff-screen-container";
import { WorkspaceHeader } from "@/components/shared/workspace-header";
import { getRepositories } from "@/lib/data/server";
import { currentActor } from "@/lib/auth/actor";

export const metadata: Metadata = {
  title: "Staff · Swiftgrocers POS",
};

/**
 * Branch roster and staff creation — SPEC §15.2.
 *
 * A branch manager creates sales people for their own branch and nobody else's;
 * the branch comes from the session rather than from a picker, so there is no
 * control here capable of putting a cashier on the wrong branch.
 */
export default async function ManagerStaffPage() {
  const repositories = await getRepositories(await currentActor());
  const roster = await repositories.staff.roster();

  return (
    <>
      <WorkspaceHeader
        title="Staff"
        subtitle={<BranchLabel suffix="roster, void and refund rates" />}
      />
      <StaffScreenContainer roster={roster} />
    </>
  );
}
