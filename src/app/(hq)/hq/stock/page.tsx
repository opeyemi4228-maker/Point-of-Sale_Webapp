import type { Metadata } from "next";
import { StockScreen } from "@/components/manager/stock-screen";
import { WorkspaceHeader } from "@/components/shared/workspace-header";
import { getRepositories } from "@/lib/data/server";
import { currentActor } from "@/lib/auth/actor";
import { todayInLagos } from "@/lib/utils/format-date";

export const metadata: Metadata = {
  title: "Branch stock · Swiftgrocers POS",
};

/**
 * One branch's stock, from HQ — SPEC §15.3. The same screen a branch manager
 * uses, with a branch picker in place of the session's branch, so the general
 * manager can receive, add and subtract on a branch's behalf. Every movement
 * still carries the name of whoever keyed it.
 */
export default async function HqStockPage() {
  const repositories = await getRepositories(await currentActor());
  const products = await repositories.catalog.listProducts();

  return (
    <>
      <WorkspaceHeader title="Branch stock" subtitle="Receive, add and subtract stock for any branch" />
      <StockScreen products={products} isoDay={todayInLagos()} />
    </>
  );
}
