import type { Metadata } from "next";
import { TillScreen } from "@/components/till/till-screen";
import { getRepositories } from "@/lib/data/server";
import { currentActor } from "@/lib/auth/actor";

export const metadata: Metadata = {
  title: "Till · Swiftgrocers POS",
};

/**
 * The till — SPEC §15.1.
 *
 * The catalog is handed down from the server as props rather than fetched in
 * the client. A till that opens to a spinner is a till that cannot take the
 * first customer of the day, and the catalog is small enough to travel with the
 * page (CLAUDE.md rule 8: the till never blocks on the network).
 *
 * Both reads happen in parallel: they do not depend on each other, and a till
 * opening is the one moment of the day nobody has patience for.
 */
export default async function TillPage() {
  const repositories = await getRepositories(await currentActor());
  const [products, categories] = await Promise.all([
    repositories.catalog.listProducts(),
    repositories.catalog.listCategories(),
  ]);

  return <TillScreen products={products} categories={categories} />;
}
