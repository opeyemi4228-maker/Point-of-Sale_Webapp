import type { Metadata } from "next";
import { ExpiryScreen } from "@/components/inventory/expiry-screen";
import { WorkspaceHeader } from "@/components/shared/workspace-header";
import { todayInLagos } from "@/lib/utils/format-date";

export const metadata: Metadata = {
  title: "Expiry & write-offs · Swiftgrocers POS",
};

/**
 * Expiry & write-offs — SPEC §10, §15.3. A thin shell: the screen reads the
 * ledger and the session itself, and HQ picks the branch on it.
 * The day is resolved here, once, so server and client agree on "today".
 */
export default function Page() {
  return (
    <>
      <WorkspaceHeader title="Expiry & write-offs" subtitle={"Expired stock and the protected write-off register, by branch"} />
      <ExpiryScreen today={todayInLagos()} />
    </>
  );
}
