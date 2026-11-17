import type { Metadata } from "next";
import { PerformanceScreen } from "@/components/reports/performance-screen";
import { WorkspaceHeader } from "@/components/shared/workspace-header";
import { todayInLagos } from "@/lib/utils/format-date";

export const metadata: Metadata = { title: "Product performance · Swiftgrocers POS" };

/** Product performance — ABC, margin, GMROI, sell-through and dead stock. */
export default function ProductPerformancePage() {
  return (
    <>
      <WorkspaceHeader
        title="Product performance"
        subtitle="Which lines earn the money, which tie it up, and which should leave the shelf"
      />
      <PerformanceScreen today={todayInLagos()} />
    </>
  );
}
