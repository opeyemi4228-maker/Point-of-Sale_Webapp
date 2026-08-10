"use client";

import { createContext, useContext } from "react";
import type { Product } from "@/types/catalog";
import type { StockEntry } from "@/types/stock";
import type { BranchSummary } from "./repositories";

/**
 * The rows a workspace was opened with.
 *
 * Every screen inside a workspace needs the same three things — the catalog,
 * the stock movements, the branch list — and each one used to import them from
 * a fixture module at the top of the file. That is precisely how the three
 * workspaces drifted apart: a screen could only ever see whatever its own
 * import happened to contain, so a badge, a dashboard and the table underneath
 * it each answered the same question differently.
 *
 * Now the workspace layout reads them once on the server, through the
 * repositories, and puts them here. One read, one answer, and no client
 * component reaches for a fixture.
 *
 * This is the *server's* view as of the request. Sales rung on this device
 * since then live in the local ledger store and are merged on top by
 * `useBranchData` — the till writes locally first and syncs behind
 * (CLAUDE.md rule 8), so the server's copy is authoritative but never current.
 */
export type WorkspaceData = {
  products: Product[];
  /** Every movement the signed-in actor is allowed to see. */
  entries: StockEntry[];
  branches: BranchSummary[];
};

const EMPTY: WorkspaceData = { products: [], entries: [], branches: [] };

const WorkspaceDataContext = createContext<WorkspaceData>(EMPTY);

export function WorkspaceDataProvider({
  value,
  children,
}: {
  value: WorkspaceData;
  children: React.ReactNode;
}) {
  return (
    <WorkspaceDataContext.Provider value={value}>
      {children}
    </WorkspaceDataContext.Provider>
  );
}

/**
 * The workspace's server rows.
 *
 * Outside a provider this returns empties rather than throwing. A screen that
 * renders no rows is recoverable and obvious; one that throws takes the whole
 * till down mid-sale, and there is no version of that which is better.
 */
export function useWorkspaceData(): WorkspaceData {
  return useContext(WorkspaceDataContext);
}

export function useWorkspaceProducts(): Product[] {
  return useContext(WorkspaceDataContext).products;
}

/** Live products only — delisted lines keep their history but leave the screens. */
export function useLiveProducts(): Product[] {
  return useContext(WorkspaceDataContext).products.filter((p) => !p.delistedAt);
}

export function useWorkspaceBranches(): BranchSummary[] {
  return useContext(WorkspaceDataContext).branches;
}
