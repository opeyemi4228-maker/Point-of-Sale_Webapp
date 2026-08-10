"use client";

import { useMemo, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, ScrollText } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { TableScroller } from "@/components/ui/table-scroller";
import { formatQty } from "@/lib/domain/quantity";
import { STOCK_REASON_LABEL } from "@/lib/domain/stock";
import { useBranchData } from "@/lib/hooks/use-branch-data";
import { useSessionStore } from "@/lib/stores/session";
import { useWorkspaceProducts } from "@/lib/data/workspace-data";
import { stamp, todayInLagos } from "@/lib/utils/format-date";
import type { StockReason } from "@/types/enums";
import { cn } from "@/lib/utils/cn";

/**
 * The stock ledger, read straight — SPEC §10.1.
 *
 * Every other stock screen shows a *balance*, which is a summary. This shows the
 * movements those balances are made of, newest first, and it is where a manager
 * goes when a figure looks wrong. Nothing here is editable and nothing is
 * hidden: an entry made in error is still an entry, sitting next to the
 * correction that reversed it (CLAUDE.md rules 3 and 4).
 */

/** Reasons that add stock. Everything else takes it away. */
const INBOUND: StockReason[] = [
  "BRANCH_OPENED",
  "PURCHASE_RECEIPT",
  "TRANSFER_IN",
  "REFUND",
  "VOID",
];

export function MovementsScreen() {
  const staff = useSessionStore((s) => s.session?.staff ?? null);
  const { entries } = useBranchData(staff?.branchId ?? null, todayInLagos());
  const [reason, setReason] = useState<StockReason | "all">("all");
  const products = useWorkspaceProducts();

  // Delisted lines are included deliberately: a movement recorded against a
  // product that has since left the catalog still has to render with its name
  // rather than a bare id.
  const names = useMemo(
    () => new Map(products.map((p) => [p.id, p.name])),
    [products],
  );

  const rows = useMemo(
    () =>
      [...entries]
        .filter((e) => reason === "all" || e.reason === reason)
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, 250),
    [entries, reason],
  );

  // Only the reasons actually present — a filter offering ten options where
  // eight return nothing is a filter that wastes a click every time.
  const present = useMemo(() => {
    const seen = new Set(entries.map((e) => e.reason));
    return (Object.keys(STOCK_REASON_LABEL) as StockReason[]).filter((r) =>
      seen.has(r),
    );
  }, [entries]);

  return (
    <main className="min-h-0 flex-1 overflow-y-auto p-5">
      <Panel>
        <PanelHeader
          title="Stock movements"
          meta={`${entries.length} recorded · newest first`}
        />

        <div className="flex flex-wrap gap-2 border-b border-line p-4">
          <Chip active={reason === "all"} onClick={() => setReason("all")}>
            All
          </Chip>
          {present.map((r) => (
            <Chip key={r} active={reason === r} onClick={() => setReason(r)}>
              {STOCK_REASON_LABEL[r]}
            </Chip>
          ))}
        </div>

        {rows.length === 0 ? (
          <EmptyState icon={ScrollText} title="No movements yet">
            Every receipt, sale, transfer and count adjustment lands here the
            moment it happens.
          </EmptyState>
        ) : (
          <TableScroller>
            <table className="w-full min-w-176 text-left">
              <thead>
                <tr className="border-b border-line text-label uppercase text-ink-40">
                  <th scope="col" className="px-5 py-3 font-semibold">When</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Product</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Reason</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">Change</th>
                  <th scope="col" className="px-4 py-3 font-semibold">By</th>
                  <th scope="col" className="px-5 py-3 font-semibold">Reference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((e) => {
                  const inbound = INBOUND.includes(e.reason);
                  const Icon = inbound ? ArrowDownLeft : ArrowUpRight;
                  return (
                    <tr key={e.id} className="hover:bg-paper">
                      <td className="px-5 py-3 font-numeric whitespace-nowrap text-ink-70">
                        {stamp(e.at)}
                      </td>
                      <th scope="row" className="px-4 py-3 font-medium text-ink">
                        {names.get(e.productId) ?? e.productId}
                      </th>
                      <td className="px-4 py-3 text-ink-70">
                        {STOCK_REASON_LABEL[e.reason]}
                      </td>
                      <td
                        className={cn(
                          "px-4 py-3 text-right font-numeric font-semibold whitespace-nowrap",
                          inbound ? "text-market" : "text-ink",
                        )}
                      >
                        {/* Direction is the sign and an arrow, never colour
                            alone (§14). */}
                        <span className="inline-flex items-center gap-1">
                          <Icon size={14} aria-hidden />
                          {e.delta.milli > 0 ? "+" : ""}
                          {formatQty(e.delta)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-ink-70">{e.staffName}</td>
                      <td className="px-5 py-3 font-mono text-label tracking-normal text-ink-40">
                        {e.ref ?? e.note ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroller>
        )}

        {entries.length > rows.length && (
          <p className="border-t border-line px-5 py-3 text-label tracking-normal text-ink-40">
            Showing the most recent {rows.length} of {entries.length}.
          </p>
        )}
      </Panel>
    </main>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "min-h-touch-admin shrink-0 rounded-pill border px-4 font-medium",
        "transition-colors duration-150 ease-out-pos",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-market",
        active
          ? "border-market bg-market text-white"
          : "border-line bg-surface text-ink-70 hover:border-market hover:text-market",
      )}
    >
      {children}
    </button>
  );
}
