"use client";

import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, PackageOpen, Truck, Warehouse } from "lucide-react";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatTile } from "@/components/ui/stat-tile";
import { EmptyState } from "@/components/ui/empty-state";
import { ExportMenu } from "@/components/ui/export-menu";
import { moneyCell, qtyCell, reportFilename, type ReportSpec } from "@/lib/export/report";
import { TableScroller } from "@/components/ui/table-scroller";
import {
  CatalogFilter,
  Chip,
  PickBranchFirst,
  ScopeControls,
  matchesCatalog,
  useCatalogFilter,
} from "@/components/inventory/scope-controls";
import { ReceiveDeliveryPanel, useDeliveryDraft } from "@/components/inventory/receive-delivery-panel";
import { daysBetween, deliveriesFrom, deliveriesWithin, type Delivery } from "@/lib/domain/inventory";
import { formatCompact, formatWhole, sum } from "@/lib/domain/money";
import { formatQty } from "@/lib/domain/quantity";
import { useLiveProducts, useWorkspaceProducts } from "@/lib/data/workspace-data";
import { ALL_BRANCHES, useCostOf, useDayRange, useInventoryScope, useScopedLedger } from "@/lib/hooks/use-inventory";
import { dayDate, stamp } from "@/lib/utils/format-date";
import { cn } from "@/lib/utils/cn";
import type { StockSource } from "@/types/stock";

/**
 * Deliveries — what was bought, from whom, and what it cost. SPEC §7.7.
 *
 * Purchases are tracked from the receipts themselves rather than from purchase
 * orders: an order is an intention, a receipt is stock on the shelf and money
 * owed. Every figure here is the ledger's `PURCHASE_RECEIPT` movements grouped
 * back into the deliveries they arrived on.
 */

type SourceFilter = "all" | StockSource["kind"];

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function DeliveriesScreen({ today }: { today: string }) {
  const scope = useInventoryScope({ allowAll: true });
  const { entries } = useScopedLedger(scope.branchId);
  const products = useWorkspaceProducts();
  const live = useLiveProducts();
  const costOf = useCostOf(products);
  const dates = useDayRange(today, "all");
  const { range } = dates;
  const [catalog, setCatalog] = useCatalogFilter();
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [open, setOpen] = useState<string | null>(null);
  const draft = useDeliveryDraft();

  const names = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const branchName = useMemo(
    () => new Map(scope.branches.map((b) => [b.id, b.name])),
    [scope.branches],
  );

  const all = useMemo(() => deliveriesFrom(entries, costOf), [entries, costOf]);
  // A product filter narrows each delivery to its matching lines and re-totals
  // it, so "how much Peak Milk did we buy" reads straight off the tiles.
  const inRange = useMemo(() => {
    const filtering = catalog.categoryId !== "all" || catalog.productId !== "all";
    const windowed = deliveriesWithin(all, range.instants);
    if (!filtering) return windowed;
    return windowed.flatMap((d) => {
      const lines = d.lines.filter((l) => {
        const p = names.get(l.productId);
        return p ? matchesCatalog(p, catalog) : false;
      });
      return lines.length ? [{ ...d, lines, value: sum(lines.map((l) => l.value)) }] : [];
    });
  }, [all, range, catalog, names]);
  const shown = inRange.filter((d) => sourceFilter === "all" || d.source?.kind === sourceFilter);

  const totals = useMemo(() => {
    const ofKind = (kind: StockSource["kind"]) =>
      sum(inRange.filter((d) => d.source?.kind === kind).map((d) => d.value));
    return {
      spend: sum(inRange.map((d) => d.value)),
      warehouse: ofKind("warehouse"),
      supplier: ofKind("supplier"),
      lines: inRange.reduce((n, d) => n + d.lines.length, 0),
      count: {
        all: inRange.length,
        warehouse: inRange.filter((d) => d.source?.kind === "warehouse").length,
        supplier: inRange.filter((d) => d.source?.kind === "supplier").length,
      },
    };
  }, [inRange]);

  // Who the branch buys from, by spend. The question a manager is asked first.
  const bySource = useMemo(() => {
    const map = new Map<string, { source: StockSource | null; deliveries: Delivery[] }>();
    for (const d of inRange) {
      const key = d.source ? `${d.source.kind}|${d.source.name}` : "unknown";
      const row = map.get(key) ?? { source: d.source, deliveries: [] };
      row.deliveries.push(d);
      map.set(key, row);
    }
    return [...map.values()]
      .map((row) => ({ ...row, value: sum(row.deliveries.map((d) => d.value)) }))
      .sort((a, b) => b.value.kobo - a.value.kobo);
  }, [inRange]);

  const knownSources = useMemo(
    () => all.flatMap((d) => (d.source ? [d.source] : [])),
    [all],
  );

  const showBranch = scope.branchId === ALL_BRANCHES;

  /** The purchases register — what was bought, from whom, line by line. */
  const buildReport = (): ReportSpec => {
    const scopeName = showBranch ? "All branches" : (scope.branch?.name ?? "Branch");
    const filterLabel =
      catalog.productId !== "all"
        ? (names.get(catalog.productId)?.name ?? "One product")
        : catalog.categoryId !== "all"
          ? (products.find((p) => p.categoryId === catalog.categoryId)?.categoryName ?? "One category")
          : "All products";
    return {
      title: "Purchases register",
      subtitle: `${scopeName} · deliveries received, at cost paid`,
      filename: reportFilename("purchases", showBranch ? "chain" : scope.branch?.code, range.fromDay, range.toDay),
      orientation: "landscape",
      meta: [
        { label: "Scope", value: scopeName },
        { label: "Period", value: `${range.label} · ${range.fromDay} to ${range.toDay}` },
        { label: "Products", value: filterLabel },
        { label: "Source", value: { all: "Warehouse and suppliers", warehouse: "Warehouse only", supplier: "Suppliers only" }[sourceFilter] },
      ],
      summary: [
        { label: "Purchases", value: formatWhole(sum(shown.map((d) => d.value))), hint: "At cost paid" },
        { label: "Deliveries", value: String(shown.length), hint: plural(shown.reduce((n, d) => n + d.lines.length, 0), "line", "lines") },
        { label: "From warehouse", value: formatWhole(totals.warehouse), hint: plural(totals.count.warehouse, "delivery", "deliveries") },
        { label: "From suppliers", value: formatWhole(totals.supplier), hint: plural(totals.count.supplier, "delivery", "deliveries") },
      ],
      tables: [
        {
          heading: "By source",
          columns: [
            { header: "Source", width: 40 },
            { header: "Kind", width: 15 },
            { header: "Deliveries", align: "right", width: 15 },
            { header: "Value", align: "right", width: 20 },
          ],
          rows: bySource
            .filter((r) => sourceFilter === "all" || r.source?.kind === sourceFilter)
            .map((r) => [
              r.source?.name ?? "Not recorded",
              r.source ? (r.source.kind === "warehouse" ? "Warehouse" : "Supplier") : "—",
              String(r.deliveries.length),
              moneyCell(r.value),
            ]),
        },
        {
          heading: "Delivery lines",
          columns: [
            { header: "Received", width: 11 },
            { header: "GRN", mono: true, width: 15 },
            { header: "From", width: 15 },
            { header: "Paperwork", mono: true, width: 9 },
            ...(showBranch ? [{ header: "Branch", width: 9 }] : []),
            { header: "Part no.", mono: true, width: 8 },
            { header: "Product", width: 18 },
            { header: "Qty", align: "right" as const, width: 7 },
            { header: "Unit cost", align: "right" as const, width: 8 },
            { header: "Value", align: "right" as const, width: 9 },
            { header: "Best before", width: 9 },
          ],
          rows: shown.flatMap((d) =>
            d.lines.map((l) => {
              const product = names.get(l.productId);
              return [
                stamp(d.at),
                d.ref,
                d.source?.name ?? "—",
                d.source?.document ?? "—",
                ...(showBranch ? [branchName.get(d.branchId) ?? d.branchId] : []),
                product?.sku ?? "—",
                product?.name ?? l.productId,
                qtyCell(l.quantity, product?.unit),
                moneyCell(l.unitCost),
                moneyCell(l.value),
                l.expiresOn ? dayDate(l.expiresOn) : "—",
              ];
            }),
          ),
          totals: [
            "", "", "", "", ...(showBranch ? [""] : []), "", "Total", "", "",
            moneyCell(sum(shown.map((d) => d.value)), { bold: true }), "",
          ],
          empty: "No deliveries in this period.",
        },
      ],
      footnote: "Built from the PURCHASE_RECEIPT movements in the stock ledger. Values are the cost actually paid where it was recorded, otherwise catalog cost.",
    };
  };

  return (
    <main className="grid min-h-0 min-w-0 flex-1 items-start gap-5 overflow-y-auto p-5 xl:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-5">
        <ScopeControls scope={scope} allowAll dates={dates}>
          <div className="ml-auto">
            <ExportMenu build={buildReport} />
          </div>
        </ScopeControls>
        <CatalogFilter products={products} value={catalog} onChange={setCatalog} />

        <div className="grid min-w-0 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <Panel>
            <StatTile label="Purchases" value={formatCompact(totals.spend)} hint={`${range.label} · at cost paid`} />
          </Panel>
          <Panel>
            <StatTile label="Deliveries" value={String(totals.count.all)} hint={`${plural(totals.lines, "line", "lines")} received`} />
          </Panel>
          <Panel>
            <StatTile icon={Warehouse} label="From warehouse" value={formatCompact(totals.warehouse)} hint={plural(totals.count.warehouse, "delivery", "deliveries")} />
          </Panel>
          <Panel>
            <StatTile icon={Truck} label="From suppliers" value={formatCompact(totals.supplier)} hint={plural(totals.count.supplier, "delivery", "deliveries")} />
          </Panel>
        </div>

        <Panel>
          <PanelHeader title="Deliveries received" meta={`${range.label} · newest first · press a row for its lines`} />

          <div className="flex flex-wrap gap-2 border-b border-line p-4">
            <Chip active={sourceFilter === "all"} onClick={() => setSourceFilter("all")} count={totals.count.all}>
              All
            </Chip>
            <Chip active={sourceFilter === "warehouse"} onClick={() => setSourceFilter("warehouse")} count={totals.count.warehouse}>
              Warehouse
            </Chip>
            <Chip active={sourceFilter === "supplier"} onClick={() => setSourceFilter("supplier")} count={totals.count.supplier}>
              Suppliers
            </Chip>
          </div>

          {shown.length === 0 ? (
            <EmptyState
              icon={PackageOpen}
              title="No deliveries in this window"
              detail="Every delivery received from the warehouse or a supplier lands here, with its paperwork number and what it cost."
            />
          ) : (
            <TableScroller>
              <table className="w-full min-w-200 text-left">
                <thead>
                  <tr className="border-b border-line text-label uppercase text-ink-40">
                    <th scope="col" className="w-10 py-3 pl-4"><span className="sr-only">Expand</span></th>
                    <th scope="col" className="px-3 py-3 font-semibold">Received</th>
                    <th scope="col" className="px-3 py-3 font-semibold">From</th>
                    {showBranch && <th scope="col" className="px-3 py-3 font-semibold">Branch</th>}
                    <th scope="col" className="px-3 py-3 text-right font-semibold">Lines</th>
                    <th scope="col" className="px-3 py-3 text-right font-semibold">Value</th>
                    <th scope="col" className="px-5 py-3 font-semibold">By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {shown.map((d) => {
                    const key = `${d.branchId}|${d.ref}`;
                    const isOpen = open === key;
                    return (
                      <Fragment key={key}>
                        <tr
                          className={cn("cursor-pointer hover:bg-paper", isOpen && "bg-paper")}
                          onClick={() => setOpen(isOpen ? null : key)}
                        >
                          <td className="py-3 pl-4">
                            <button
                              type="button"
                              aria-expanded={isOpen}
                              aria-label={`${isOpen ? "Hide" : "Show"} lines of ${d.ref}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                setOpen(isOpen ? null : key);
                              }}
                              className="grid size-touch-admin place-items-center rounded-input text-ink-40 hover:bg-market-tint hover:text-market focus-visible:outline-2 focus-visible:outline-market"
                            >
                              {isOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                            </button>
                          </td>
                          <td className="px-3 py-3">
                            <span className="block font-numeric whitespace-nowrap text-ink">{stamp(d.at)}</span>
                            <span className="block font-mono text-label tracking-normal text-ink-40">{d.ref}</span>
                          </td>
                          <td className="px-3 py-3">
                            <SourceLabel source={d.source} />
                            {d.orderRef && (
                              <span className="mt-1 block font-mono text-label tracking-normal text-ink-40">
                                Against {d.orderRef}
                              </span>
                            )}
                          </td>
                          {showBranch && <td className="px-3 py-3 text-ink-70">{branchName.get(d.branchId) ?? d.branchId}</td>}
                          <td className="px-3 py-3 text-right font-numeric text-ink-70">{d.lines.length}</td>
                          <td className="px-3 py-3 text-right font-numeric font-semibold text-ink">{formatWhole(d.value)}</td>
                          <td className="px-5 py-3 text-ink-70">{d.staffName}</td>
                        </tr>
                        {isOpen && (
                          <tr className="bg-paper">
                            <td colSpan={showBranch ? 7 : 6} className="px-4 pb-4">
                              <table className="w-full rounded-input border border-line bg-surface text-left">
                                <thead>
                                  <tr className="border-b border-line text-label uppercase text-ink-40">
                                    <th scope="col" className="px-4 py-2 font-semibold">Product</th>
                                    <th scope="col" className="px-3 py-2 text-right font-semibold">Qty</th>
                                    <th scope="col" className="px-3 py-2 text-right font-semibold">Unit cost</th>
                                    <th scope="col" className="px-3 py-2 text-right font-semibold">Value</th>
                                    <th scope="col" className="px-4 py-2 font-semibold">Best before</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-line">
                                  {d.lines.map((line) => {
                                    const product = names.get(line.productId);
                                    const left = line.expiresOn ? daysBetween(today, line.expiresOn) : null;
                                    return (
                                      <tr key={line.entryId}>
                                        <th scope="row" className="px-4 py-2 font-medium text-ink">
                                          {product?.name ?? line.productId}
                                        </th>
                                        <td className="px-3 py-2 text-right font-numeric text-ink-70">
                                          {formatQty(line.quantity)} {product?.unit}
                                        </td>
                                        <td className="px-3 py-2 text-right font-numeric text-ink-70">{formatWhole(line.unitCost)}</td>
                                        <td className="px-3 py-2 text-right font-numeric text-ink">{formatWhole(line.value)}</td>
                                        <td className="px-4 py-2 text-ink-70">
                                          {line.expiresOn ? (
                                            <>
                                              {dayDate(line.expiresOn)}
                                              {left !== null && left <= 0 && (
                                                <span className="ml-2 font-semibold text-halt">· past date</span>
                                              )}
                                            </>
                                          ) : (
                                            <span className="text-ink-40">Does not date</span>
                                          )}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                              {d.source?.document && (
                                <p className="mt-2 text-body text-ink-70">
                                  Their paperwork: <span className="font-mono text-ink">{d.source.document}</span>
                                </p>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </TableScroller>
          )}
        </Panel>
      </div>

      <div className="flex min-w-0 flex-col gap-5">
        {scope.staff && scope.branch ? (
          <ReceiveDeliveryPanel
            draft={draft}
            products={live}
            branchId={scope.branch.id}
            branchCode={scope.branch.code}
            staff={scope.staff}
            today={today}
            knownSources={knownSources}
          />
        ) : (
          <Panel>
            <PanelHeader title="Receive a delivery" />
            <PickBranchFirst what="receive a delivery" />
          </Panel>
        )}

        <Panel>
          <PanelHeader title="By source" meta={range.label} />
          {bySource.length === 0 ? (
            <p className="px-5 py-6 text-body text-ink-70">Nothing received in this window.</p>
          ) : (
            <ul className="divide-y divide-line">
              {bySource.map((row) => {
                const share = totals.spend.kobo ? row.value.kobo / totals.spend.kobo : 0;
                return (
                  <li key={row.source ? `${row.source.kind}|${row.source.name}` : "unknown"} className="px-5 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <SourceLabel source={row.source} compact />
                      <span className="font-numeric font-semibold text-ink">{formatWhole(row.value)}</span>
                    </div>
                    <div className="mt-2 flex items-center gap-3">
                      <div className="h-2 flex-1 overflow-hidden rounded-pill bg-paper" aria-hidden>
                        <div className="h-full rounded-pill bg-market" style={{ width: `${Math.max(2, share * 100)}%` }} />
                      </div>
                      <span className="w-28 shrink-0 text-right text-label tracking-normal text-ink-40">
                        {Math.round(share * 100)}% · {row.deliveries.length} {row.deliveries.length === 1 ? "delivery" : "deliveries"}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
    </main>
  );
}

function SourceLabel({ source, compact }: { source: StockSource | null; compact?: boolean }) {
  if (!source) return <span className="text-ink-40">Not recorded</span>;
  const Icon = source.kind === "warehouse" ? Warehouse : Truck;
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span
        aria-hidden
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-input",
          source.kind === "warehouse" ? "bg-market-tint text-market" : "bg-zest-tint text-zest-deep",
        )}
      >
        <Icon size={16} />
      </span>
      <span className="min-w-0">
        <span className="block truncate font-medium text-ink">{source.name}</span>
        <span className="block text-label tracking-normal text-ink-40">
          {source.kind === "warehouse" ? "Warehouse" : "Supplier"}
          {!compact && source.document ? ` · ${source.document}` : ""}
        </span>
      </span>
    </span>
  );
}
