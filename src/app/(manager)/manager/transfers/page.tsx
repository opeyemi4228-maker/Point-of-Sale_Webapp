import type { Metadata } from "next";
import { ArrowRightLeft, Plus } from "lucide-react";
import { BranchLabel } from "@/components/shared/branch-label";
import { WorkspaceHeader } from "@/components/shared/workspace-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { TableScroller } from "@/components/ui/table-scroller";
import { BRANCH_NAME, CURRENT_BRANCH_ID } from "@/lib/data/mock/branches";
import { MOCK_TRANSFERS } from "@/lib/data/mock/operations";
import { formatWhole } from "@/lib/domain/money";
import { formatQty } from "@/lib/domain/quantity";
import { stamp } from "@/lib/utils/format-date";
import type { Transfer } from "@/types/operations";
import { PageBody } from "@/components/ui/page-body";

export const metadata: Metadata = {
  title: "Transfers · Swiftgrocers POS",
};

const STATUS: Record<Transfer["status"], { tone: StatusTone; label: string }> = {
  requested: { tone: "waiting", label: "Requested" },
  approved: { tone: "live", label: "Approved" },
  in_transit: { tone: "live", label: "In transit" },
  received: { tone: "done", label: "Received" },
  rejected: { tone: "stopped", label: "Rejected" },
};

/**
 * Inter-branch transfers — SPEC §7.7.
 *
 * A transfer debits one branch and credits the other in a single transaction —
 * which is precisely why branches share one database rather than each having
 * their own (§4). Stock in transit belongs to neither balance until it is
 * received, and a shortfall on receipt is a shrinkage event, not a silent edit.
 */
export default function ManagerTransfersPage() {
  const incoming = MOCK_TRANSFERS.filter((t) => t.toBranchId === CURRENT_BRANCH_ID);
  const outgoing = MOCK_TRANSFERS.filter((t) => t.fromBranchId === CURRENT_BRANCH_ID);

  return (
    <>
      <WorkspaceHeader
        title="Transfers"
        subtitle={<BranchLabel suffix="stock moving in and out" />}
        actions={
          <Button>
            <Plus size={18} aria-hidden />
            Request stock
          </Button>
        }
      />

      <PageBody>
        <TransferTable
          title="Coming in"
          meta="Accept on arrival and record any shortfall — the difference is a shrinkage event"
          transfers={incoming}
          counterpartyLabel="From"
          counterparty={(t) => BRANCH_NAME[t.fromBranchId] ?? t.fromBranchId}
        />
        <TransferTable
          title="Going out"
          meta="Leaves this branch's balance only once HQ approves the move"
          transfers={outgoing}
          counterpartyLabel="To"
          counterparty={(t) => BRANCH_NAME[t.toBranchId] ?? t.toBranchId}
        />
      </PageBody>
    </>
  );
}

function TransferTable({
  title,
  meta,
  transfers,
  counterpartyLabel,
  counterparty,
}: {
  title: string;
  meta: string;
  transfers: Transfer[];
  counterpartyLabel: string;
  counterparty: (t: Transfer) => string;
}) {
  return (
    <Panel>
      <PanelHeader title={title} meta={meta} />

      {transfers.length === 0 ? (
        <EmptyState
          icon={ArrowRightLeft}
          title="Nothing moving"
          detail="Transfers appear here from the moment they are requested until they are received."
        />
      ) : (
        <TableScroller>
          <table className="w-full min-w-200 text-left">
            <thead>
              <tr className="border-b border-line text-label uppercase text-ink-40">
                <th scope="col" className="px-5 py-3 font-semibold">Transfer</th>
                <th scope="col" className="px-5 py-3 font-semibold">{counterpartyLabel}</th>
                <th scope="col" className="px-5 py-3 font-semibold">Status</th>
                <th scope="col" className="px-5 py-3 text-right font-semibold">Lines</th>
                <th scope="col" className="px-5 py-3 text-right font-semibold">Units</th>
                <th scope="col" className="px-5 py-3 text-right font-semibold">Value</th>
                <th scope="col" className="px-5 py-3 font-semibold">Requested</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {transfers.map((transfer) => {
                const status = STATUS[transfer.status];
                return (
                  <tr key={transfer.id} className="hover:bg-paper">
                    <th scope="row" className="px-5 py-3.5 font-mono font-medium text-ink">
                      {transfer.reference}
                    </th>
                    <td className="px-5 py-3.5 text-ink-70">{counterparty(transfer)}</td>
                    <td className="px-5 py-3.5">
                      <StatusPill tone={status.tone}>{status.label}</StatusPill>
                    </td>
                    <td className="px-5 py-3.5 text-right font-numeric text-ink-70">
                      {transfer.lines}
                    </td>
                    <td className="px-5 py-3.5 text-right font-numeric text-ink-70">
                      {formatQty(transfer.totalQty)}
                    </td>
                    <td className="px-5 py-3.5 text-right font-numeric font-medium text-ink">
                      {formatWhole(transfer.value)}
                    </td>
                    <td className="px-5 py-3.5 text-ink-70">
                      {stamp(transfer.requestedAt)}
                      <span className="block text-label text-ink-40">
                        {transfer.requestedBy}
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
  );
}
