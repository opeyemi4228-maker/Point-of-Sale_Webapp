import type { Metadata } from "next";
import { Plus, Truck } from "lucide-react";
import { BranchLabel } from "@/components/shared/branch-label";
import { WorkspaceHeader } from "@/components/shared/workspace-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { TableScroller } from "@/components/ui/table-scroller";
import { MOCK_PURCHASE_ORDERS } from "@/lib/data/mock/operations";
import { formatWhole, sum } from "@/lib/domain/money";
import { longDate, stamp } from "@/lib/utils/format-date";
import type { PurchaseOrder } from "@/types/operations";
import { PageBody } from "@/components/ui/page-body";

export const metadata: Metadata = {
  title: "Purchase orders · Swiftgrocers POS",
};

const STATUS: Record<PurchaseOrder["status"], { tone: StatusTone; label: string }> = {
  draft: { tone: "idle", label: "Draft" },
  sent: { tone: "live", label: "Sent" },
  partially_received: { tone: "waiting", label: "Part received" },
  received: { tone: "done", label: "Received" },
  cancelled: { tone: "stopped", label: "Cancelled" },
};

/**
 * Purchase orders — SPEC §7.7.
 *
 * Receiving against an order is what writes `PURCHASE_RECEIPT` movements into
 * the ledger; the order itself moves no stock. That separation is why a delivery
 * that arrives short is visible as a difference between ordered and received
 * rather than disappearing into a corrected balance.
 */
export default function ManagerOrdersPage() {
  const open = MOCK_PURCHASE_ORDERS.filter(
    (po) => po.status === "sent" || po.status === "partially_received",
  );
  const committed = sum(open.map((po) => po.total));

  return (
    <>
      <WorkspaceHeader
        title="Purchase orders"
        subtitle={<BranchLabel suffix="what is on order and what has landed" />}
        actions={
          <Button>
            <Plus size={18} aria-hidden />
            New order
          </Button>
        }
      />

      <PageBody>
        <Panel>
          <PanelHeader
            title="Orders"
            meta={
              open.length === 0
                ? "Nothing outstanding"
                : `${open.length} open · ${formatWhole(committed)} committed to suppliers`
            }
          />

          {MOCK_PURCHASE_ORDERS.length === 0 ? (
            <EmptyState
              icon={Truck}
              title="No purchase orders"
              detail="Raise one from the reorder list on the stock screen, or start a blank order for a supplier."
              action={
                <Button>
                  <Plus size={18} aria-hidden />
                  New order
                </Button>
              }
            />
          ) : (
            <TableScroller>
              <table className="w-full min-w-200 text-left">
                <thead>
                  <tr className="border-b border-line text-label uppercase text-ink-40">
                    <th scope="col" className="px-5 py-3 font-semibold">Order</th>
                    <th scope="col" className="px-5 py-3 font-semibold">Supplier</th>
                    <th scope="col" className="px-5 py-3 font-semibold">Status</th>
                    <th scope="col" className="px-5 py-3 text-right font-semibold">Lines</th>
                    <th scope="col" className="px-5 py-3 text-right font-semibold">Value</th>
                    <th scope="col" className="px-5 py-3 font-semibold">Expected</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {MOCK_PURCHASE_ORDERS.map((po) => {
                    const status = STATUS[po.status];
                    return (
                      <tr key={po.id} className="hover:bg-paper">
                        <th scope="row" className="px-5 py-3.5">
                          <span className="font-mono font-medium text-ink">{po.reference}</span>
                          <span className="block text-label text-ink-40">
                            Raised {stamp(po.createdAt)}
                          </span>
                        </th>
                        <td className="px-5 py-3.5 text-ink-70">{po.supplier}</td>
                        <td className="px-5 py-3.5">
                          <StatusPill tone={status.tone}>{status.label}</StatusPill>
                        </td>
                        <td className="px-5 py-3.5 text-right font-numeric text-ink-70">
                          {po.lines}
                        </td>
                        <td className="px-5 py-3.5 text-right font-numeric font-medium text-ink">
                          {formatWhole(po.total)}
                        </td>
                        <td className="px-5 py-3.5 text-ink-70">
                          {po.expectedOn ? longDate(po.expectedOn) : "Not sent yet"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableScroller>
          )}
        </Panel>
      </PageBody>
    </>
  );
}
