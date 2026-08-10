"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ArrowRight, Building2, CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatTile } from "@/components/ui/stat-tile";
import { TableScroller } from "@/components/ui/table-scroller";
import { ZERO, formatWhole, kobo, sum } from "@/lib/domain/money";
import { ZERO_QTY } from "@/lib/domain/quantity";
import { balancesForBranch, isLow, isOversold } from "@/lib/domain/stock";
import { useChainEntries, stockValue } from "@/lib/hooks/use-branch-data";
import { useLedgerStore } from "@/lib/stores/ledger";
import { useLiveProducts, useWorkspaceBranches } from "@/lib/data/workspace-data";
import { isoDay, todayInLagos } from "@/lib/utils/format-date";
import { cn } from "@/lib/utils/cn";

/**
 * Every branch, side by side — SPEC §15.3.
 *
 * HQ's question is not "how is the chain doing" — the overview answers that. It
 * is "which branch needs me today". So the table is ordered by trouble first
 * and takings second, and the state column reads a branch's whole stock
 * position into one word rather than leaving four numbers to be compared by eye.
 */
export function BranchesScreen() {
  const { entries } = useChainEntries();
  const sales = useLedgerStore((s) => s.sales);
  const day = todayInLagos();
  const live = useLiveProducts();
  const branches = useWorkspaceBranches();

  const rows = useMemo(() => {
    return branches.map((branch) => {
      const balances = balancesForBranch(entries, branch.id);
      const low = live.filter((p) => {
        const q = balances.get(p.id)?.onHand ?? ZERO_QTY;
        return !isOversold(q) && isLow(q, p.reorderLevel);
      }).length;
      const oversold = live.filter((p) =>
        isOversold(balances.get(p.id)?.onHand ?? ZERO_QTY),
      ).length;

      const todays = sales.filter(
        (s) => s.branchId === branch.id && isoDay(s.at) === day,
      );
      const takings = sum(todays.map((s) => s.total));

      return {
        branch,
        low,
        oversold,
        takings,
        transactions: todays.length,
        basket: todays.length ? kobo(Math.round(takings.kobo / todays.length)) : ZERO,
        stock: stockValue(balances, live),
      };
    }).sort(
      (a, b) =>
        b.oversold - a.oversold || b.low - a.low || b.takings.kobo - a.takings.kobo,
    );
  }, [entries, sales, day, live, branches]);

  const chainTakings = sum(rows.map((r) => r.takings));
  const chainStock = sum(rows.map((r) => r.stock));
  const needAttention = rows.filter((r) => r.oversold > 0 || r.low > 0).length;

  return (
    <main className="min-h-0 flex-1 overflow-y-auto flex min-w-0 flex-col gap-5 p-5">
      <div className="grid min-w-0 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <Panel>
          <StatTile label="Branches" value={String(rows.length)} hint="Trading today" />
        </Panel>
        <Panel>
          <StatTile label="Chain takings" value={formatWhole(chainTakings)} hint="Today" />
        </Panel>
        <Panel>
          <StatTile label="Stock value" value={formatWhole(chainStock)} hint="At cost" />
        </Panel>
        <Panel>
          <StatTile
            label="Need attention"
            value={String(needAttention)}
            hint="Low or oversold lines"
          />
        </Panel>
      </div>

      <Panel>
        <PanelHeader title="Branches" meta="Trouble first, then takings" />

        <TableScroller>
          <table className="w-full min-w-176 text-left">
            <thead>
              <tr className="border-b border-line text-label uppercase text-ink-40">
                <th scope="col" className="px-5 py-3 font-semibold">Branch</th>
                <th scope="col" className="px-4 py-3 font-semibold">Stock state</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">Takings</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">Txns</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">Basket</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">Stock value</th>
                <th scope="col" className="px-5 py-3 font-semibold">
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.branch.id} className="hover:bg-paper">
                  <th scope="row" className="px-5 py-3.5 font-medium text-ink">
                    {r.branch.name}
                    <span className="block text-label tracking-normal text-ink-40">
                      {r.branch.city}
                    </span>
                  </th>
                  <td className="px-4 py-3.5">
                    <State oversold={r.oversold} low={r.low} />
                  </td>
                  <td className="px-4 py-3.5 text-right font-numeric font-semibold text-ink">
                    {formatWhole(r.takings)}
                  </td>
                  <td className="px-4 py-3.5 text-right font-numeric text-ink-70">
                    {r.transactions}
                  </td>
                  <td className="px-4 py-3.5 text-right font-numeric text-ink-70">
                    {r.transactions ? formatWhole(r.basket) : "—"}
                  </td>
                  <td className="px-4 py-3.5 text-right font-numeric text-ink-70">
                    {formatWhole(r.stock)}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <Link
                      href="/hq/catalog"
                      className="inline-flex min-h-touch-admin items-center gap-1 rounded-input px-2 font-medium text-market transition-colors duration-150 ease-out-pos hover:bg-market-tint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-market"
                    >
                      Stock
                      <ArrowRight size={16} aria-hidden />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroller>

        <p className="flex items-center gap-2 border-t border-line px-5 py-3 text-label tracking-normal text-ink-40">
          <Building2 size={14} aria-hidden />
          Takings are what the tills have recorded today. Stock figures are summed
          from the ledger.
        </p>
      </Panel>
    </main>
  );
}

function State({ oversold, low }: { oversold: number; low: number }) {
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
