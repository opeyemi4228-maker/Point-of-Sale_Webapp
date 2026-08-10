import type { Metadata } from "next";
import { BranchLabel } from "@/components/shared/branch-label";
import { ManagerOverviewScreen } from "@/components/manager/overview-screen";
import { WorkspaceHeader } from "@/components/shared/workspace-header";
import { getRepositories } from "@/lib/data/server";
import { currentActor } from "@/lib/auth/actor";
import { longDate, todayInLagos } from "@/lib/utils/format-date";

export const metadata: Metadata = {
  title: "Branch overview · Swiftgrocers POS",
};

/**
 * Branch manager home — SPEC §15.2.
 *
 * Two halves, deliberately. The figures below come from the shared ledger
 * inside the client component, so this screen and the till cannot hold
 * different versions of the day. Who is on shift comes from the server, because
 * a shift is opened by somebody else's sign-in on somebody else's device — this
 * till has no way of knowing about it.
 */
export default async function ManagerHomePage() {
  const day = todayInLagos();
  const repositories = await getRepositories(await currentActor());
  const { onShift } = await repositories.dashboards.manager(day);

  return (
    <>
      <WorkspaceHeader
        title="Overview"
        subtitle={<BranchLabel suffix={longDate(day)} />}
      />
      <ManagerOverviewScreen isoDay={day} onShift={onShift} />
    </>
  );
}
