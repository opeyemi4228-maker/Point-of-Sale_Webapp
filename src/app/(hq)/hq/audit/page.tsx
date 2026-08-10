import type { Metadata } from "next";
import { ScrollText } from "lucide-react";
import { WorkspaceHeader } from "@/components/shared/workspace-header";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { TableScroller } from "@/components/ui/table-scroller";
import { BRANCH_NAME } from "@/lib/data/mock/branches";
import { MOCK_AUDIT } from "@/lib/data/mock/operations";
import { stamp } from "@/lib/utils/format-date";
import { PageBody } from "@/components/ui/page-body";

export const metadata: Metadata = {
  title: "Audit log · Swiftgrocers POS",
};

/**
 * The audit log — SPEC §7.8, §17.
 *
 * Append-only, and the reason the rest of the system can be trusted: nothing is
 * hard-deleted anywhere (CLAUDE.md rule 4), so every privileged action leaves a
 * row here with an actor against it. Never anonymous, never silent.
 *
 * Admin sees the chain; a branch manager sees their own branch and nothing else,
 * enforced by row-level security rather than by a filter on this page (§8).
 */
export default function HqAuditPage() {
  return (
    <>
      <WorkspaceHeader
        title="Audit log"
        subtitle="Every privileged action, with the person who took it"
      />

      <PageBody>
        <Alert tone="info" title="Append-only">
          Rows here are never edited or removed, including by an administrator. Financial and
          fiscal records are retained for seven years (§13.1).
        </Alert>

        <Panel>
          <PanelHeader title="Recent activity" meta="Newest first" />

          {MOCK_AUDIT.length === 0 ? (
            <EmptyState
              icon={ScrollText}
              title="Nothing recorded yet"
              detail="Price changes, staff suspensions, approvals, reprints and branch provisioning all land here."
            />
          ) : (
            <TableScroller>
              <table className="w-full min-w-240 text-left">
                <thead>
                  <tr className="border-b border-line text-label uppercase text-ink-40">
                    <th scope="col" className="px-5 py-3 font-semibold">Action</th>
                    <th scope="col" className="px-5 py-3 font-semibold">Actor</th>
                    <th scope="col" className="px-5 py-3 font-semibold">Entity</th>
                    <th scope="col" className="px-5 py-3 font-semibold">Branch</th>
                    <th scope="col" className="px-5 py-3 font-semibold">When</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {MOCK_AUDIT.map((entry) => (
                    <tr key={entry.id} className="hover:bg-paper">
                      <th scope="row" className="px-5 py-3.5">
                        <span className="font-mono font-medium text-ink">{entry.action}</span>
                        <span className="mt-0.5 block max-w-md text-body text-ink-70">
                          {entry.detail}
                        </span>
                      </th>
                      <td className="px-5 py-3.5 text-ink-70">
                        {entry.actorName}
                        <span className="block text-label text-ink-40">{entry.actorRole}</span>
                      </td>
                      <td className="px-5 py-3.5 text-ink-70">{entry.entity}</td>
                      <td className="px-5 py-3.5 text-ink-70">
                        {entry.branchId
                          ? (BRANCH_NAME[entry.branchId] ?? entry.branchId)
                          : "Chain-wide"}
                      </td>
                      <td className="px-5 py-3.5 whitespace-nowrap text-ink-70">
                        {stamp(entry.occurredAt)}
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
