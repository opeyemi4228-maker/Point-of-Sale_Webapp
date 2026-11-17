import type { Metadata } from "next";
import { BranchLabel } from "@/components/shared/branch-label";
import { ProductDatabaseScreen } from "@/components/products/product-database-screen";
import { WorkspaceHeader } from "@/components/shared/workspace-header";
import { todayInLagos } from "@/lib/utils/format-date";

export const metadata: Metadata = {
  title: "Product database · Swiftgrocers POS",
};

/**
 * Product database — SPEC §7.3. Every product by part number, with its
 * barcodes, pricing and this branch's stock. A thin shell: the catalog and the
 * ledger are read by the screen from the workspace data.
 */
export default function ManagerProductsPage() {
  return (
    <>
      <WorkspaceHeader
        title="Product database"
        subtitle={<BranchLabel suffix="part numbers, barcodes and prices" />}
      />
      <ProductDatabaseScreen today={todayInLagos()} />
    </>
  );
}
