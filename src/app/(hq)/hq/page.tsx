import type { Metadata } from "next";
import Link from "next/link";
import { Plus, TrendingDown, TrendingUp, TriangleAlert } from "lucide-react";
import { AttentionList } from "@/components/shared/attention-list";
import { WorkspaceHeader } from "@/components/shared/workspace-header";
import { Button } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { TableScroller } from "@/components/ui/table-scroller";
import { StatTile } from "@/components/ui/stat-tile";
import { getRepositories } from "@/lib/data/server";
import { currentActor } from "@/lib/auth/actor";
import { format, formatCompact, formatWhole, toNaira } from "@/lib/domain/money";
import { longDate, shortTime, todayInLagos } from "@/lib/utils/format-date";
import { cn } from "@/lib/utils/cn";
import { PageBody } from "@/components/ui/page-body";

export const metadata: Metadata = {
  title: "HQ overview · Swiftgrocers POS",
};

/**
 * General admin home — SPEC §15.3.
 *
 * Consolidated across every branch. The branch table is sorted by sales so the
 * chain's shape is legible at a glance, and the row that is doing badly is
 * marked by its numbers and an icon, never by a colour wash alone (§14).
 *
 * Read on the server, in one round trip, and rendered as static markup. Every
 * figure here is derived from the same ledger and sales rows the detail screens
 * read, so the chain total and the branch pages cannot disagree.
 */
export default async function HqHomePage() {
  const repositories = await getRepositories(await currentActor());
  const { asOf, today, branches, attention } = await repositories.dashboards.hq(
    todayInLagos(),
  );

  const busiest = Math.max(...branches.map((b) => toNaira(b.sales)));

  return (
    <>
      <WorkspaceHeader
        title="Swiftgrocers HQ"
        subtitle={`${longDate(asOf)} · ${branches.length} branches trading`}
        actions={
          <Button>
            <Plus size={18} aria-hidden />
            New branch
          </Button>
        }
      />

      <PageBody>
        {/* ── Chain figures ──────────────────────────────────────────────── */}
        <Panel>
          <PanelHeader title="Today, chain-wide" meta={`As at ${shortTime(asOf)}`} />
          <div className="grid divide-line sm:grid-cols-2 sm:divide-x lg:grid-cols-5">
            <StatTile
              label="Sales"
              value={formatCompact(today.sales)}
              hint={format(today.sales)}
            />
            <StatTile
              label="Transactions"
              value={today.transactions.toLocaleString("en-NG")}
              hint="Across every till"
            />
            <StatTile
              label="Average basket"
              value={formatWhole(today.averageBasket)}
              hint="Sales ÷ transactions"
            />
            <StatTile
              label="Gross margin"
              value={`${today.marginPercent.toFixed(1)}%`}
              hint="After cost of goods"
            />
            <StatTile
              label="Loyalty issued"
              value={formatCompact(today.loyaltyIssued)}
              hint="Points credited today"
            />
          </div>
        </Panel>

        {/* ── Branch performance ─────────────────────────────────────────── */}
        <Panel>
          <PanelHeader
            title="Branch performance"
            meta="Sorted by sales today · compared with the same day last week"
          />

          <TableScroller>
            <table className="w-full min-w-200 text-left">
              <thead>
                <tr className="border-b border-line text-label uppercase text-ink-40">
                  <th scope="col" className="px-5 py-3 font-semibold">Branch</th>
                  <th scope="col" className="px-5 py-3 text-right font-semibold">
                    Sales today
                  </th>
                  <th scope="col" className="px-5 py-3 text-right font-semibold">
                    vs last week
                  </th>
                  <th scope="col" className="px-5 py-3 text-right font-semibold">Txns</th>
                  <th scope="col" className="px-5 py-3 text-right font-semibold">Basket</th>
                  <th scope="col" className="px-5 py-3 text-right font-semibold">Margin</th>
                  <th scope="col" className="px-5 py-3 text-right font-semibold">Alerts</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-line">
                {branches.map((branch) => {
                  const rising = branch.deltaPercent >= 0;
                  const Trend = rising ? TrendingUp : TrendingDown;
                  const share = (toNaira(branch.sales) / busiest) * 100;

                  return (
                    <tr key={branch.id} className="group hover:bg-paper">
                      <th scope="row" className="px-5 py-3.5">
                        <Link
                          href="/hq/branches"
                          className="font-medium text-ink hover:text-market focus-visible:outline-2 focus-visible:outline-market"
                        >
                          {branch.name}
                        </Link>
                        {/* A quiet share-of-chain bar. Magnitude at a glance,
                            with the exact figure in the next column. */}
                        <span
                          aria-hidden
                          className="mt-1.5 block h-1 w-24 overflow-hidden rounded-pill bg-line"
                        >
                          <span
                            className="block h-full rounded-pill bg-market"
                            style={{ width: `${share}%` }}
                          />
                        </span>
                      </th>

                      <td className="px-5 py-3.5 text-right font-numeric font-medium text-ink">
                        {formatWhole(branch.sales)}
                      </td>

                      <td className="px-5 py-3.5 text-right">
                        <span
                          className={cn(
                            "inline-flex items-center justify-end gap-1 font-numeric font-medium",
                            rising ? "text-market" : "text-halt",
                          )}
                        >
                          <Trend size={16} aria-hidden />
                          {rising ? "+" : ""}
                          {branch.deltaPercent.toFixed(1)}%
                        </span>
                      </td>

                      <td className="px-5 py-3.5 text-right font-numeric text-ink-70">
                        {branch.transactions}
                      </td>
                      <td className="px-5 py-3.5 text-right font-numeric text-ink-70">
                        {formatWhole(branch.averageBasket)}
                      </td>
                      <td className="px-5 py-3.5 text-right font-numeric text-ink-70">
                        {branch.marginPercent.toFixed(1)}%
                      </td>

                      <td className="px-5 py-3.5 text-right">
                        {branch.alerts === 0 ? (
                          <span className="text-ink-40">None</span>
                        ) : (
                          <span
                            className={cn(
                              "font-numeric inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-1 font-semibold",
                              branch.alertsAreSerious
                                ? "border-halt/30 bg-halt-tint text-ink"
                                : "border-line bg-paper text-ink-70",
                            )}
                          >
                            {branch.alertsAreSerious && (
                              <TriangleAlert size={14} aria-hidden className="text-halt" />
                            )}
                            {branch.alerts}
                            <span className="sr-only">
                              {branch.alertsAreSerious
                                ? " alerts, needs attention"
                                : " alerts"}
                            </span>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroller>
        </Panel>

        {/* ── Chain-wide attention ───────────────────────────────────────── */}
        <Panel>
          <PanelHeader
            title="Chain-wide attention"
            meta="Patterns no single branch manager can see"
          />
          <AttentionList items={attention} />
        </Panel>
      </PageBody>
    </>
  );
}
