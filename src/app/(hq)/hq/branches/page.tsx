import type { Metadata } from "next";
import { BranchesScreen } from "@/components/hq/branches-screen";
import { WorkspaceHeader } from "@/components/shared/workspace-header";
import { longDate, todayInLagos } from "@/lib/utils/format-date";

export const metadata: Metadata = { title: "Branches · Swiftgrocers POS" };

/** Every branch side by side — SPEC §15.3. */
export default function HqBranchesPage() {
  return (
    <>
      <WorkspaceHeader title="Branches" subtitle={longDate(todayInLagos())} />
      <BranchesScreen />
    </>
  );
}
