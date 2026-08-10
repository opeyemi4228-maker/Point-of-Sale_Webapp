import type { Metadata } from "next";
import { ChainStockScreen } from "@/components/hq/chain-stock-screen";
import { WorkspaceHeader } from "@/components/shared/workspace-header";
import { getRepositories } from "@/lib/data/server";
import { currentActor } from "@/lib/auth/actor";

export const metadata: Metadata = {
  title: "Master catalog · Swiftgrocers POS",
};

/** Chain-wide stock — SPEC §15.3. Thin shell; figures come from the ledger. */
export default async function HqCatalogPage() {
  const repositories = await getRepositories(await currentActor());
  const [products, branches] = await Promise.all([
    repositories.catalog.listProducts(),
    repositories.branches.list(),
  ]);
  const lines = products.filter((product) => !product.delistedAt).length;

  return (
    <>
      <WorkspaceHeader
        title="Master catalog"
        subtitle={`${lines} live lines across ${branches.length} branches`}
      />
      <ChainStockScreen />
    </>
  );
}
