import type { Metadata } from "next";
import { ShiftScreen } from "@/components/till/shift-screen";
import { WorkspaceHeader } from "@/components/shared/workspace-header";

export const metadata: Metadata = { title: "Shift · Swiftgrocers POS" };

/** The cashier's drawer, reconciled against the sales they rang — SPEC §11.4. */
export default function TillShiftPage() {
  return (
    <>
      <WorkspaceHeader title="Shift" subtitle="Your drawer, and the count you close on" />
      <ShiftScreen />
    </>
  );
}
