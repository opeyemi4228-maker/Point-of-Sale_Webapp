"use client";

import { Users } from "lucide-react";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatTile } from "@/components/ui/stat-tile";
import { TableScroller } from "@/components/ui/table-scroller";
import { ZERO, kobo, sum } from "@/lib/domain/money";
import { formatWhole } from "@/lib/domain/money";
import { useSellerTotals } from "@/lib/hooks/use-branch-data";
import { cn } from "@/lib/utils/cn";

/**
 * Sales per person — SPEC §15.3.
 *
 * Live rows only, rolled up from the sales the tills actually recorded. It used
 * to render a static fixture, which meant HQ could be looking at takings for
 * people who had sold nothing all day — a report that is confidently wrong is
 * worse than one that is empty, because nobody checks it.
 *
 * Deliberately not a bare leaderboard. Ranking by takings alone rewards
 * whoever worked the busiest till; the basket size and the share of the day's
 * total sit beside it so the number can be read in context.
 */
export function SellersScreen({ isoDay }: { isoDay: string }) {
  const { ready, rows } = useSellerTotals(isoDay);

  const chainTotal = rows.length ? sum(rows.map((row) => row.sales)) : ZERO;
  const transactions = rows.reduce((n, row) => n + row.transactions, 0);
  const averageBasket = transactions
    ? kobo(Math.round(chainTotal.kobo / transactions))
    : ZERO;

  return (
    <main className="min-h-0 flex-1 overflow-y-auto flex min-w-0 flex-col gap-5 p-5">
      <div className="grid min-w-0 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <Panel>
          <StatTile label="Sales today" value={formatWhole(chainTotal)} hint="Every branch" />
        </Panel>
        <Panel>
          <StatTile
            label="Transactions"
            value={transactions.toLocaleString("en-NG")}
            hint="Completed sales"
          />
        </Panel>
        <Panel>
          <StatTile
            label="Average basket"
            value={formatWhole(averageBasket)}
            hint="Chain-wide"
          />
        </Panel>
        <Panel>
          <StatTile label="Selling today" value={String(rows.length)} hint="People with sales" />
        </Panel>
      </div>

      <Panel>
        <PanelHeader
          title="Sales by person"
          meta="Rolled up from the sales each till recorded"
        />

        {!ready ? (
          <p className="px-5 py-10 text-center text-body text-ink-70">Loading…</p>
        ) : rows.length === 0 ? (
          <div className="grid place-items-center gap-2 px-5 py-14 text-center">
            <Users size={36} aria-hidden className="text-ink-40" />
            <p className="text-body-lg font-medium text-ink">No sales recorded today</p>
            <p className="max-w-96 text-body text-ink-70">
              This fills in as tills settle sales. Open the till, ring one
              through, and the person appears here.
            </p>
          </div>
        ) : (
          <TableScroller>
            <table className="w-full min-w-160 text-left">
              <thead>
                <tr className="border-b border-line text-label uppercase text-ink-40">
                  <th scope="col" className="px-5 py-3 font-semibold">Person</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Branch</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">Sales</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">Txns</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">Basket</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">Items</th>
                  <th scope="col" className="px-5 py-3 font-semibold">Share of day</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((row) => {
                  const share = chainTotal.kobo
                    ? row.sales.kobo / chainTotal.kobo
                    : 0;
                  const basket = row.transactions
                    ? kobo(Math.round(row.sales.kobo / row.transactions))
                    : ZERO;

                  return (
                    <tr key={row.staffId} className="hover:bg-paper">
                      <th scope="row" className="px-5 py-3.5 font-medium text-ink">
                        {row.staffName}
                      </th>
                      <td className="px-4 py-3.5 text-ink-70">{row.branchName}</td>
                      <td className="px-4 py-3.5 text-right font-numeric font-semibold text-ink">
                        {formatWhole(row.sales)}
                      </td>
                      <td className="px-4 py-3.5 text-right font-numeric text-ink-70">
                        {row.transactions}
                      </td>
                      <td className="px-4 py-3.5 text-right font-numeric text-ink-70">
                        {formatWhole(basket)}
                      </td>
                      <td className="px-4 py-3.5 text-right font-numeric text-ink-70">
                        {row.items}
                      </td>
                      <td className="px-5 py-3.5">
                        {/* The bar is a second encoding of the number beside
                            it, never the only one — the percentage is written
                            out (§14). */}
                        <span className="flex items-center gap-2.5">
                          <span
                            aria-hidden
                            className="h-1.5 w-24 shrink-0 overflow-hidden rounded-pill bg-line"
                          >
                            <span
                              className={cn("block h-full rounded-pill bg-market")}
                              style={{ width: `${Math.round(share * 100)}%` }}
                            />
                          </span>
                          <span className="font-numeric text-label tracking-normal text-ink-70">
                            {(share * 100).toFixed(1)}%
                          </span>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroller>
        )}
      </Panel>
    </main>
  );
}
