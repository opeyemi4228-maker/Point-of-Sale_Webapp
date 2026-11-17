import type { Metadata } from "next";
import { BranchLabel } from "@/components/shared/branch-label";
import { CountSheetScreen } from "@/components/counts/count-sheet-screen";
import { WorkspaceHeader } from "@/components/shared/workspace-header";

export const metadata: Metadata = { title: "Stock count · Swiftgrocers POS" };

/** One count sheet — counting, review and posting (SPEC §10.3). */
export default async function CountSheetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <WorkspaceHeader title="Stock count" subtitle={<BranchLabel suffix="count, review, post" />} />
      <CountSheetScreen id={id} />
    </>
  );
}
