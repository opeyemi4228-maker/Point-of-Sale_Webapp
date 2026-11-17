import { getRepositories } from "@/lib/data/server";
import { currentActor } from "@/lib/auth/actor";
import { WorkspaceDataProvider } from "./workspace-data";

/**
 * Loads a workspace's rows once, on the server, and hands them to the screens.
 *
 * One read per navigation, scoped by row-level security to whoever is signed
 * in — so a branch manager's `entries` are their branch's and HQ's are the
 * chain's, without either layout saying so. The scoping is the database's job
 * (docs/DATABASE.md §3); this component only decides *when* to read.
 *
 * The reads are independent, so they go out together. A workspace that
 * opens in three sequential round trips feels broken on a shop's connection.
 */
export async function WorkspaceShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const repositories = await getRepositories(await currentActor());

  const [products, entries, branches, orders] = await Promise.all([
    repositories.catalog.listProducts(),
    repositories.stock.listEntries(),
    repositories.branches.list(),
    repositories.purchasing.listOrders(),
  ]);

  return (
    <WorkspaceDataProvider value={{ products, entries, branches, orders }}>
      {children}
    </WorkspaceDataProvider>
  );
}
