"use client";

import { useMemo, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, ScrollText } from "lucide-react";
import { CatalogFilter, ScopeControls, matchesCatalog, useCatalogFilter } from "@/components/inventory/scope-controls";
import { EmptyState } from "@/components/ui/empty-state";
import { ExportMenu } from "@/components/ui/export-menu";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { TableScroller } from "@/components/ui/table-scroller";
import { formatQty } from "@/lib/domain/quantity";
import { STOCK_REASON_LABEL } from "@/lib/domain/stock";
import { useBranchData } from "@/lib/hooks/use-branch-data";
import { useDayRange } from "@/lib/hooks/use-inventory";
import { useSessionStore } from "@/lib/stores/session";
import { useWorkspaceProducts } from "@/lib/data/workspace-data";
import { stamp, todayInLagos } from "@/lib/utils/format-date";
import { qtyCell, reportFilename, type ReportSpec } from "@/lib/export/report";
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
  const dates = useDayRange(todayInLagos(), "all");
  const { range } = dates;
  const [catalog, setCatalog] = useCatalogFilter();

  // Delisted lines are included deliberately: a movement recorded against a
  // product that has since left the catalog still has to render with its name
  // rather than a bare id.
  const names = useMemo(
    () => new Map(products.map((p) => [p.id, p.name])),
    [products],
  );
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  // Period and product first; the reason chips then count within that.
  const inScope = useMemo(() => {
    const from = Date.parse(range.instants.from);
    const to = Date.parse(range.instants.to);
    return entries.filter((e) => {
      const t = Date.parse(e.at);
      if (t < from || t >= to) return false;
      const product = byId.get(e.productId);
      return product ? matchesCatalog(product, catalog) : catalog.productId === "all" && catalog.categoryId === "all";
    });
  }, [entries, range.instants, byId, catalog]);

  const filtered = useMemo(
    () =>
      inScope
        .filter((e) => reason === "all" || e.reason === reason)
        .sort((a, b) => b.at.localeCompare(a.at)),
    [inScope, reason],
  );
  // The screen shows the latest 250; the export carries every one.
  const rows = useMemo(() => filtered.slice(0, 250), [filtered]);

  const buildReport = (): ReportSpec => {
    const today = todayInLagos();
    return {
      title: "Stock ledger",
      subtitle: `${staff?.branchName ?? "Branch"} · every stock movement, newest first`,
      filename: reportFilename("stock-ledger", staff?.branchName, reason === "all" ? null : reason, today),
      orientation: "landscape",
      meta: [
        { label: "Branch", value: staff?.branchName ?? "—" },
        { label: "Period", value: `${range.label} · ${range.fromDay} to ${range.toDay}` },
        { label: "Movements", value: reason === "all" ? "All reasons" : STOCK_REASON_LABEL[reason] },
        {
          label: "Products",
          value:
            catalog.productId !== "all"
              ? (byId.get(catalog.productId)?.name ?? "One product")
              : catalog.categoryId !== "all"
                ? (products.find((p) => p.categoryId === catalog.categoryId)?.categoryName ?? "One category")
                : "All products",
        },
        { label: "Entries", value: String(filtered.length) },

      ],
      tables: [
        {
          columns: [
            { header: "When", width: 14 },
            { header: "Part no.", mono: true, width: 9 },
            { header: "Product", width: 24 },
            { header: "Movement", width: 14 },
            { header: "Change", align: "right", width: 9 },
            { header: "By", width: 13 },
            { header: "Reference", mono: true, width: 17 },
          ],
          rows: filtered.map((e) => {
            const product = byId.get(e.productId);
            return [
              stamp(e.at),
              product?.sku ?? "—",
              product?.name ?? e.productId,
              STOCK_REASON_LABEL[e.reason],
              qtyCell(e.delta, product?.unit, { signed: true, tone: e.delta.milli > 0 ? "market" : undefined }),
              e.staffName,
              e.ref ?? e.note ?? "—",
            ];
          }),
          empty: "No movements recorded.",
        },
      ],
      footnote:
        "The ledger is append-only. A mistake is corrected by a new movement, so errors and their corrections both appear here.",
    };
  };

  // Only the reasons actually present — a filter offering ten options where
  // eight return nothing is a filter that wastes a click every time.
  const present = useMemo(() => {
    const seen = new Set(inScope.map((e) => e.reason));
    return (Object.keys(STOCK_REASON_LABEL) as StockReason[]).filter((r) =>
      seen.has(r),
    );
  }, [inScope]);

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4 sm:p-5">
      <ScopeControls allowAll={false} dates={dates}>
        <CatalogFilter products={products} value={catalog} onChange={setCatalog} />
      </ScopeControls>

      <Panel>
        <PanelHeader
          title="Stock movements"
          meta={`${inScope.length} in this period${inScope.length !== entries.length ? ` of ${entries.length} recorded` : ""} · newest first`}
          action={<ExportMenu build={buildReport} disabled={filtered.length === 0} />}
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

        {filtered.length > rows.length && (
          <p className="border-t border-line px-5 py-3 text-label tracking-normal text-ink-40">
            Showing the most recent {rows.length} of {filtered.length}. The export carries all of them.
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
