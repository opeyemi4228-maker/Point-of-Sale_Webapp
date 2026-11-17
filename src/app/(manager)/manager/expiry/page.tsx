import type { Metadata } from "next";
import { BranchLabel } from "@/components/shared/branch-label";
import { ExpiryScreen } from "@/components/inventory/expiry-screen";
import { WorkspaceHeader } from "@/components/shared/workspace-header";
import { todayInLagos } from "@/lib/utils/format-date";

export const metadata: Metadata = {
  title: "Expiry & write-offs · Swiftgrocers POS",
};

/**
 * Expiry & write-offs — SPEC §10, §15.2. A thin shell: the screen reads the
 * ledger and the session itself.
 * The day is resolved here, once, so server and client agree on "today".
 */
export default function Page() {
  return (
    <>
      <WorkspaceHeader title="Expiry & write-offs" subtitle={<BranchLabel suffix="expired stock and the protected write-off register" />} />
      <ExpiryScreen today={todayInLagos()} />
    </>
  );
}
