import type { Metadata } from "next";
import { ProductDatabaseScreen } from "@/components/products/product-database-screen";
import { WorkspaceHeader } from "@/components/shared/workspace-header";
import { todayInLagos } from "@/lib/utils/format-date";

export const metadata: Metadata = {
  title: "Product database · Swiftgrocers POS",
};

/**
 * Product database, chain-wide — SPEC §7.3, §15.3. The same register a branch
 * sees, with stock summed across branches or narrowed to one.
 */
export default function HqProductsPage() {
  return (
    <>
      <WorkspaceHeader
        title="Product database"
        subtitle="Every product in the chain — part numbers, barcodes, prices and stock"
      />
      <ProductDatabaseScreen today={todayInLagos()} />
    </>
  );
}
