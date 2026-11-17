"use client";

import { useMemo } from "react";
import { CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatTile } from "@/components/ui/stat-tile";
import { TableScroller } from "@/components/ui/table-scroller";
import { useLiveProducts, useWorkspaceBranches } from "@/lib/data/workspace-data";
import { formatWhole, multiply, sum } from "@/lib/domain/money";
import { ZERO_QTY, addQty, formatQty, toNumber, type Quantity } from "@/lib/domain/quantity";
import { balancesByBranch, isLow, isOversold } from "@/lib/domain/stock";
import { useChainEntries } from "@/lib/hooks/use-branch-data";
import { cn } from "@/lib/utils/cn";

/**
 * Chain-wide stock — SPEC §15.3.
 *
 * What HQ needs that a branch manager does not: one product across every branch
 * at once. A line that is healthy chain-wide but empty in Lekki is an
 * imbalance, and the fix is a transfer rather than a purchase order — which is
 * only visible if the branches sit side by side in one row.
 *
 * Reads the shared ledger, so a delivery a manager scans in and a sale a
 * cashier rings both land here without a refresh.
 */
export function ChainStockScreen() {
  const { entries } = useChainEntries();
  const live = useLiveProducts();
  const branches = useWorkspaceBranches();

  const rows = useMemo(
    () =>
      live
        .map((product) => {
          const byBranchMap = balancesByBranch(entries, product.id);
          const byBranch = branches.map((branch) => ({
            branchId: branch.id,
            branchName: branch.name,
            onHand: byBranchMap.get(branch.id) ?? ZERO_QTY,
          }));
          const total = byBranch.reduce<Quantity>(
            (running, cell) => addQty(running, cell.onHand),
            ZERO_QTY,
          );

          return {
            product,
            byBranch,
            total,
            branchesLow: byBranch.filter((c) => isLow(c.onHand, product.reorderLevel))
              .length,
            branchesOversold: byBranch.filter((c) => isOversold(c.onHand)).length,
            value: multiply(product.cost, toNumber(total)),
          };
        })
        // Worth acting on first: oversold anywhere, then the most branches low.
        .sort(
          (a, b) =>
            b.branchesOversold - a.branchesOversold ||
            b.branchesLow - a.branchesLow ||
            a.product.name.localeCompare(b.product.name),
        ),
    [entries, branches, live],
  );

  const chainValue = sum(rows.map((row) => row.value));
  const linesLow = rows.filter((row) => row.branchesLow > 0).length;
  const linesOversold = rows.filter((row) => row.branchesOversold > 0).length;

  return (
    <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
      <div className="flex min-w-0 flex-col gap-5 p-5">
      <div className="grid min-w-0 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <Panel>
          <StatTile label="Stock value" value={formatWhole(chainValue)} hint="At cost, chain-wide" />
        </Panel>
        <Panel>
          <StatTile label="Live lines" value={String(rows.length)} hint="Not delisted" />
        </Panel>
        <Panel>
          <StatTile label="Low somewhere" value={String(linesLow)} hint="In one or more branches" />
        </Panel>
        <Panel>
          <StatTile label="Oversold" value={String(linesOversold)} hint="Below zero somewhere" />
        </Panel>
      </div>

      <Panel>
        <PanelHeader
          title="Stock by branch"
          meta="Summed from the stock ledger — no stored quantities"
        />

        <TableScroller>
          <table className="w-full min-w-200 text-left">
            <thead>
              <tr className="border-b border-line text-label uppercase text-ink-40">
                <th scope="col" className="px-5 py-3 font-semibold">Product</th>
                <th scope="col" className="px-4 py-3 font-semibold">State</th>
                {branches.map((branch) => (
                  <th key={branch.id} scope="col" className="px-4 py-3 text-right font-semibold">
                    {branch.name}
                  </th>
                ))}
                <th scope="col" className="px-4 py-3 text-right font-semibold">Chain</th>
                <th scope="col" className="px-5 py-3 text-right font-semibold">Value</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-line">
              {rows.map((row) => (
                <tr key={row.product.id} className="hover:bg-paper">
                  <th scope="row" className="px-5 py-3.5 font-medium text-ink">
                    {row.product.name}
                    <span className="font-mono block text-label tracking-normal text-ink-40">
                      {row.product.sku} · reorder at {formatQty(row.product.reorderLevel)}
                    </span>
                  </th>

                  <td className="px-4 py-3.5">
                    <ChainState oversold={row.branchesOversold} low={row.branchesLow} />
                  </td>

                  {row.byBranch.map((cell) => {
                    const oversold = isOversold(cell.onHand);
                    const low = isLow(cell.onHand, row.product.reorderLevel);
                    return (
                      <td
                        key={cell.branchId}
                        className={cn(
                          "px-4 py-3.5 text-right font-numeric",
                          oversold
                            ? "font-semibold text-halt"
                            : low
                              ? "font-semibold text-signal"
                              : "text-ink-70",
                        )}
                      >
                        {/* The figure carries the state as well as the colour:
                            a low cell is bracketed, an oversold one is signed. */}
                        {low && !oversold
                          ? `(${formatQty(cell.onHand)})`
                          : formatQty(cell.onHand)}
                      </td>
                    );
                  })}

                  <td className="px-4 py-3.5 text-right font-numeric font-semibold text-ink">
                    {formatQty(row.total)}
                    <span className="ml-1 font-normal text-ink-40">{row.product.unit}</span>
                  </td>
                  <td className="px-5 py-3.5 text-right font-numeric text-ink-70">
                    {formatWhole(row.value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroller>

        <p className="border-t border-line px-5 py-3 text-label tracking-normal text-ink-40">
          A bracketed figure is at or below that branch&rsquo;s reorder level. A
          negative figure means more was sold than the branch held — usually a
          till that kept trading offline.
        </p>
      </Panel>
    </div>
    </main>
  );
}

function ChainState({ oversold, low }: { oversold: number; low: number }) {
  const shape =
    oversold > 0
      ? { icon: CircleAlert, tone: "bg-halt-tint text-halt", label: `${oversold} oversold` }
      : low > 0
        ? { icon: TriangleAlert, tone: "bg-sun text-ink", label: `${low} low` }
        : { icon: CircleCheck, tone: "bg-market-tint text-market", label: "Healthy" };

  const Icon = shape.icon;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-label font-semibold tracking-normal",
        shape.tone,
      )}
    >
      <Icon size={14} aria-hidden />
      {shape.label}
    </span>
  );
}
