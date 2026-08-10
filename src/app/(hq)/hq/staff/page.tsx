import type { Metadata } from "next";
import { SellersScreen } from "@/components/hq/sellers-screen";
import { WorkspaceHeader } from "@/components/shared/workspace-header";
import { longDate, todayInLagos } from "@/lib/utils/format-date";

export const metadata: Metadata = {
  title: "Staff & sales · Swiftgrocers POS",
};

/**
 * Sales per person, chain-wide — SPEC §15.3.
 *
 * Rolled up from the sales the tills recorded, not from a fixture, so this and
 * the cashier's own "My sales" screen are two views of one set of records.
 */
export default function HqStaffPage() {
  const day = todayInLagos();
  return (
    <>
      <WorkspaceHeader title="Staff & sales" subtitle={longDate(day)} />
      <SellersScreen isoDay={day} />
    </>
  );
}
