import type { Metadata } from "next";
import { IdCard } from "lucide-react";
import { BranchLabel } from "@/components/shared/branch-label";
import { WorkspaceHeader } from "@/components/shared/workspace-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatTile } from "@/components/ui/stat-tile";
import { TableScroller } from "@/components/ui/table-scroller";
import { maskPhone } from "@/lib/data/mock/people";
import { getRepositories } from "@/lib/data/server";
import { currentActor } from "@/lib/auth/actor";
import { formatWhole, sum, naira } from "@/lib/domain/money";
import { stamp } from "@/lib/utils/format-date";
import { PageBody } from "@/components/ui/page-body";

export const metadata: Metadata = {
  title: "Customers · Swiftgrocers POS",
};

/**
 * Loyalty members — SPEC §11.
 *
 * The phone number is the card: no plastic, no app, one field at enrolment. It
 * is masked here and everywhere except a single detail view (§17) — a roster on
 * a manager's screen in a back office is exactly where a full list of customer
 * numbers should not be sitting.
 *
 * Points are a ledger, like stock. The balance shown is derived from it and is
 * never edited directly (CLAUDE.md rule 3).
 */
export default async function ManagerCustomersPage() {
  const repositories = await getRepositories(await currentActor());
  const customers = await repositories.customers.list();

  const totalPoints = customers.reduce((n, c) => n + c.pointsBalance, 0);
  const lifetime = sum(customers.map((c) => c.lifetimeSpend));

  return (
    <>
      <WorkspaceHeader
        title="Customers"
        subtitle={<BranchLabel suffix="loyalty members enrolled here" />}
      />

      <PageBody>
        <Panel>
          <div className="grid divide-line sm:grid-cols-3 sm:divide-x">
            <StatTile label="Members" value={String(customers.length)} hint="Enrolled at this branch" />
            <StatTile
              label="Points outstanding"
              value={totalPoints.toLocaleString("en-NG")}
              hint={`A liability of ${formatWhole(naira(totalPoints))} at ₦1 a point`}
            />
            <StatTile
              label="Lifetime spend"
              value={formatWhole(lifetime)}
              hint="Across every visit"
            />
          </div>
        </Panel>

        <Panel>
          <PanelHeader
            title="Members"
            meta="Phone numbers are masked here — the full number appears on the customer's own record only"
          />

          {customers.length === 0 ? (
            <EmptyState
              icon={IdCard}
              title="Nobody enrolled yet"
              detail="A cashier enrols a customer at the till in under ten seconds — one field, the phone number."
            />
          ) : (
            <TableScroller>
              <table className="w-full min-w-200 text-left">
                <thead>
                  <tr className="border-b border-line text-label uppercase text-ink-40">
                    <th scope="col" className="px-5 py-3 font-semibold">Customer</th>
                    <th scope="col" className="px-5 py-3 font-semibold">Phone</th>
                    <th scope="col" className="px-5 py-3 text-right font-semibold">Visits</th>
                    <th scope="col" className="px-5 py-3 text-right font-semibold">Lifetime spend</th>
                    <th scope="col" className="px-5 py-3 text-right font-semibold">Points</th>
                    <th scope="col" className="px-5 py-3 font-semibold">Last visit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {customers.map((customer) => (
                    <tr key={customer.id} className="hover:bg-paper">
                      <th scope="row" className="px-5 py-3.5 font-medium text-ink">
                        {customer.fullName}
                        <span className="block text-label text-ink-40">
                          Member since {stamp(customer.enrolledAt)}
                        </span>
                      </th>
                      <td className="px-5 py-3.5 font-mono text-ink-70">
                        {maskPhone(customer.phone)}
                      </td>
                      <td className="px-5 py-3.5 text-right font-numeric text-ink-70">
                        {customer.visits}
                      </td>
                      <td className="px-5 py-3.5 text-right font-numeric font-medium text-ink">
                        {formatWhole(customer.lifetimeSpend)}
                      </td>
                      <td className="px-5 py-3.5 text-right font-numeric text-ink">
                        {customer.pointsBalance.toLocaleString("en-NG")}
                      </td>
                      <td className="px-5 py-3.5 text-ink-70">
                        {customer.lastVisitAt ? stamp(customer.lastVisitAt) : "Never"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroller>
          )}
        </Panel>
      </PageBody>
    </>
  );
}
