import type { Metadata } from "next";
import { BranchLabel } from "@/components/shared/branch-label";
import { StockScreen } from "@/components/manager/stock-screen";
import { WorkspaceHeader } from "@/components/shared/workspace-header";
import { getRepositories } from "@/lib/data/server";
import { currentActor } from "@/lib/auth/actor";
import { todayInLagos } from "@/lib/utils/format-date";

export const metadata: Metadata = {
  title: "Stock · Swiftgrocers POS",
};

/**
 * Branch stock — SPEC §10, §15.2.
 *
 * The branch and the person come from the session, inside the client component,
 * not from props guessed here. The catalog travels with the page; the ledger is
 * read from the shared local store so a delivery received here and a sale rung
 * at the till are the same set of movements.
 */
export default async function ManagerStockPage() {
  const repositories = await getRepositories(await currentActor());
  const products = await repositories.catalog.listProducts();

  return (
    <>
      <WorkspaceHeader
        title="Stock"
        subtitle={<BranchLabel suffix="on hand and deliveries" />}
      />
      <StockScreen products={products} isoDay={todayInLagos()} />
    </>
  );
}
