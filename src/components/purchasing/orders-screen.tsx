"use client";

import { Fragment, useMemo, useState } from "react";
import {
  Ban,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  PackageCheck,
  Pencil,
  Plus,
  Search,
  Send,
  TriangleAlert,
} from "lucide-react";
import { OrderSheet } from "@/components/purchasing/order-sheet";
import { ReceiveOrderSheet } from "@/components/purchasing/receive-order-sheet";
import {
  CatalogFilter,
  Chip,
  ScopeControls,
  matchesCatalog,
  useCatalogFilter,
} from "@/components/inventory/scope-controls";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ExportMenu } from "@/components/ui/export-menu";
import { moneyCell, qtyCell, reportFilename, type ReportSpec } from "@/lib/export/report";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Sheet } from "@/components/ui/sheet";
import { StatTile } from "@/components/ui/stat-tile";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { TableScroller } from "@/components/ui/table-scroller";
import { formatCompact, formatWhole, multiply, sum } from "@/lib/domain/money";
import { formatQty } from "@/lib/domain/quantity";
import {
  isOpen,
  onOrderByProduct,
  orderProgress,
  type OrderProgress,
  type OrderStatus,
} from "@/lib/domain/purchasing";
import { useWorkspaceProducts } from "@/lib/data/workspace-data";
import { ALL_BRANCHES, useDayRange, useInventoryScope, useScopedLedger } from "@/lib/hooks/use-inventory";
import { usePurchaseOrderStore, usePurchaseOrders } from "@/lib/stores/purchase-orders";
import { dayDate, stamp } from "@/lib/utils/format-date";
import { cn } from "@/lib/utils/cn";
import type { PurchaseOrder } from "@/types/operations";

/**
 * Purchase orders — SPEC §7.7.
 *
 * What is on order, what has landed and what is late. Every quantity "received"
 * on this screen is the ledger's receipts against the order, so the order, the
 * stock figures and the deliveries list all agree by construction (rule 3).
 */

const STATUS: Record<OrderStatus, { tone: StatusTone; label: string }> = {
  draft: { tone: "idle", label: "Draft" },
  sent: { tone: "live", label: "Sent" },
  partially_received: { tone: "waiting", label: "Part received" },
  received: { tone: "done", label: "Received" },
  cancelled: { tone: "stopped", label: "Cancelled" },
};

type Tab = "all" | "draft" | "open" | "overdue" | "received" | "cancelled";

const TABS: { value: Tab; label: string; match: (p: OrderProgress) => boolean }[] = [
  { value: "all", label: "All", match: () => true },
  { value: "open", label: "Open", match: (p) => isOpen(p.status) },
  { value: "overdue", label: "Overdue", match: (p) => p.overdue },
  { value: "draft", label: "Drafts", match: (p) => p.status === "draft" },
  { value: "received", label: "Received", match: (p) => p.status === "received" },
  { value: "cancelled", label: "Cancelled", match: (p) => p.status === "cancelled" },
];

type Sheet =
  | { kind: "new" }
  | { kind: "edit"; order: PurchaseOrder }
  | { kind: "receive"; order: PurchaseOrder }
  | { kind: "cancel"; order: PurchaseOrder };

export function OrdersScreen({ today }: { today: string }) {
  const scope = useInventoryScope({ allowAll: true });
  const { entries } = useScopedLedger(scope.branchId);
  const { entries: chainEntries } = useScopedLedger(ALL_BRANCHES);
  const { orders, eventsFor } = usePurchaseOrders(scope.branchId);
  const { orders: chainOrders } = usePurchaseOrders(ALL_BRANCHES);
  const products = useWorkspaceProducts();
  const save = usePurchaseOrderStore((s) => s.save);
  const dates = useDayRange(today, "all");
  const { range } = dates;
  const [catalog, setCatalog] = useCatalogFilter();

  const [tab, setTab] = useState<Tab>("open");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const branchById = useMemo(() => new Map(scope.branches.map((b) => [b.id, b])), [scope.branches]);
  const showBranch = scope.branchId === ALL_BRANCHES;

  const withProgress = useMemo(
    () => orders.map((order) => ({ order, progress: orderProgress(order, entries, today) })),
    [orders, entries, today],
  );

  // Filters other than the status tab, so the tab counts answer "how many of
  // what I am looking at are overdue", not "how many in the whole chain".
  const filtered = useMemo(() => {
    const from = Date.parse(range.instants.from);
    const to = Date.parse(range.instants.to);
    const q = query.trim().toLowerCase();
    return withProgress.filter(({ order }) => {
      const t = Date.parse(order.createdAt);
      if (t < from || t >= to) return false;
      if (q && !`${order.reference} ${order.supplier}`.toLowerCase().includes(q)) return false;
      if (catalog.categoryId !== "all" || catalog.productId !== "all") {
        return order.lines.some((l) => {
          const p = productById.get(l.productId);
          return p ? matchesCatalog(p, catalog) : false;
        });
      }
      return true;
    });
  }, [withProgress, range, query, catalog, productById]);

  const shown = filtered.filter(({ progress }) => TABS.find((t) => t.value === tab)!.match(progress));

  const stats = useMemo(() => {
    const openOnes = filtered.filter((o) => isOpen(o.progress.status));
    const from = Date.parse(range.instants.from);
    const to = Date.parse(range.instants.to);
    const receivedInWindow = sum(
      filtered.flatMap(({ order, progress }) =>
        progress.receipts
          .filter((r) => {
            const t = Date.parse(r.at);
            return t >= from && t < to;
          })
          .map((r) => {
            const line = order.lines.find((l) => l.productId === r.productId);
            return multiply(r.unitCost ?? line?.unitCost ?? { kobo: 0 }, r.delta.milli / 1000);
          }),
      ),
    );
    return {
      open: openOnes.length,
      outstanding: sum(openOnes.map((o) => o.progress.outstandingValue)),
      overdue: filtered.filter((o) => o.progress.overdue).length,
      overdueValue: sum(filtered.filter((o) => o.progress.overdue).map((o) => o.progress.outstandingValue)),
      drafts: filtered.filter((o) => o.progress.status === "draft").length,
      draftValue: sum(filtered.filter((o) => o.progress.status === "draft").map((o) => o.progress.orderedValue)),
      receivedInWindow,
    };
  }, [filtered, range]);

  const knownSuppliers = useMemo(() => {
    const list: { name: string; kind: "warehouse" | "supplier" }[] = chainOrders.map((o) => ({
      name: o.supplier,
      kind: o.supplierKind,
    }));
    for (const e of chainEntries) if (e.source) list.push({ name: e.source.name, kind: e.source.kind });
    return list;
  }, [chainOrders, chainEntries]);

  const onOrderForBranch = useMemo(
    () =>
      onOrderByProduct(
        withProgress.filter(({ order }) => order.branchId === scope.branch?.id).map((o) => o.progress),
      ),
    [withProgress, scope.branch],
  );

  function send(order: PurchaseOrder) {
    if (!scope.staff) return;
    if (!order.expectedOn) {
      setNotice(null);
      setSheet({ kind: "edit", order });
      return;
    }
    const now = new Date().toISOString();
    save({ ...order, sentAt: now }, { action: "sent", at: now, by: scope.staff.fullName, detail: `To ${order.supplier}` });
    setNotice(`${order.reference} sent to ${order.supplier}.`);
  }

  /** The order register — every order in view, with what has landed. */
  const buildRegister = (): ReportSpec => {
    const scopeName = showBranch ? "All branches" : (scope.branch?.name ?? "Branch");
    return {
      title: "Purchase orders",
      subtitle: `${scopeName} · what is on order and what has landed`,
      filename: reportFilename("purchase-orders", showBranch ? "chain" : scope.branch?.code, tab, today),
      orientation: "landscape",
      meta: [
        { label: "Scope", value: scopeName },
        { label: "Raised in", value: `${range.label} · ${range.fromDay} to ${range.toDay}` },
        { label: "Showing", value: TABS.find((t) => t.value === tab)?.label ?? "All" },
        { label: "Orders", value: String(shown.length) },
      ],
      summary: [
        { label: "Still to arrive", value: formatWhole(stats.outstanding), hint: `${stats.open} open` },
        { label: "Overdue", value: String(stats.overdue), hint: formatWhole(stats.overdueValue) },
        { label: "Drafts", value: String(stats.drafts), hint: formatWhole(stats.draftValue) },
        { label: "Received in period", value: formatWhole(stats.receivedInWindow), hint: "Against orders" },
      ],
      tables: [
        {
          heading: "Orders",
          columns: [
            { header: "Order", mono: true, width: 13 },
            { header: "Supplier", width: 17 },
            ...(showBranch ? [{ header: "Branch", width: 10 }] : []),
            { header: "Status", width: 10 },
            { header: "Raised", width: 11 },
            { header: "Expected", width: 10 },
            { header: "Ordered", align: "right" as const, width: 10 },
            { header: "Received", align: "right" as const, width: 10 },
            { header: "Outstanding", align: "right" as const, width: 10 },
            { header: "Filled", align: "right" as const, width: 6 },
          ],
          rows: shown.map(({ order, progress }) => [
            order.reference,
            order.supplier,
            ...(showBranch ? [branchById.get(order.branchId)?.name ?? order.branchId] : []),
            progress.overdue
              ? { text: `${STATUS[progress.status].label} · ${progress.daysLate}d late`, tone: "halt" as const }
              : STATUS[progress.status].label,
            stamp(order.createdAt),
            order.expectedOn ? dayDate(order.expectedOn) : "—",
            moneyCell(progress.orderedValue),
            moneyCell(progress.receivedValue),
            moneyCell(progress.outstandingValue),
            `${Math.round(progress.fulfilment * 100)}%`,
          ]),
          totals: [
            "", "Total", ...(showBranch ? [""] : []), "", "", "",
            moneyCell(sum(shown.map((o) => o.progress.orderedValue)), { bold: true }),
            moneyCell(sum(shown.map((o) => o.progress.receivedValue)), { bold: true }),
            moneyCell(sum(shown.map((o) => o.progress.outstandingValue)), { bold: true }),
            "",
          ],
          empty: "No orders match this selection.",
        },
        {
          heading: "Order lines",
          columns: [
            { header: "Order", mono: true, width: 13 },
            { header: "Part no.", mono: true, width: 9 },
            { header: "Product", width: 24 },
            { header: "Ordered", align: "right" as const, width: 9 },
            { header: "Received", align: "right" as const, width: 9 },
            { header: "Outstanding", align: "right" as const, width: 9 },
            { header: "Unit cost", align: "right" as const, width: 9 },
            { header: "Line value", align: "right" as const, width: 10 },
          ],
          rows: shown.flatMap(({ order, progress }) =>
            progress.lines.map((l) => {
              const p = productById.get(l.productId);
              return [
                order.reference,
                p?.sku ?? "—",
                p?.name ?? l.productId,
                qtyCell(l.ordered, p?.unit),
                qtyCell(l.received, p?.unit),
                qtyCell(l.outstanding, p?.unit, { tone: l.outstanding.milli > 0 && progress.overdue ? "halt" : undefined }),
                moneyCell(l.unitCost),
                moneyCell(l.orderedValue),
              ];
            }),
          ),
        },
      ],
      footnote: "Received quantities are the ledger's goods-received movements against each order — never typed onto the order itself.",
    };
  };

  /** One order as a document to send to the supplier. */
  const buildPurchaseOrder = (order: PurchaseOrder, progress: OrderProgress): ReportSpec => {
    const branch = branchById.get(order.branchId);
    return {
      title: `Purchase order ${order.reference}`,
      subtitle: `To ${order.supplier} · deliver to Swiftgrocers ${branch?.name ?? ""}`.trim(),
      filename: reportFilename("purchase-order", order.reference),
      meta: [
        { label: "Order number", value: order.reference },
        { label: "Supplier", value: order.supplier },
        { label: "Deliver to", value: branch ? `Swiftgrocers ${branch.name}` : "—" },
        { label: "Delivery date", value: order.expectedOn ? dayDate(order.expectedOn) : "To be agreed" },
        { label: "Raised", value: `${stamp(order.createdAt)} · ${order.createdBy}` },
        { label: "Status", value: STATUS[progress.status].label },
      ],
      tables: [
        {
          columns: [
            { header: "#", align: "right", width: 4 },
            { header: "Part no.", mono: true, width: 12 },
            { header: "Description", width: 38 },
            { header: "Qty", align: "right", width: 10 },
            { header: "Unit", width: 7 },
            { header: "Unit cost", align: "right", width: 13 },
            { header: "Amount", align: "right", width: 15 },
          ],
          rows: progress.lines.map((l, i) => {
            const p = productById.get(l.productId);
            return [
              String(i + 1),
              p?.sku ?? "—",
              p?.name ?? l.productId,
              qtyCell(l.ordered),
              p?.unit ?? "",
              moneyCell(l.unitCost),
              moneyCell(l.orderedValue),
            ];
          }),
          totals: ["", "", "Order total", "", "", "", moneyCell(progress.orderedValue, { bold: true })],
        },
      ],
      footnote: [
        order.note ? `Note: ${order.note}` : null,
        `Quote ${order.reference} on the waybill or invoice. Goods are checked against this order on arrival; short or substituted lines are recorded as received.`,
        "Authorised by: ____________________    Signature: ____________________",
      ]
        .filter(Boolean)
        .join("\n\n"),
    };
  };

  const done = (message: string) => {
    setSheet(null);
    setNotice(message);
  };

  const sheetBranch =
    sheet && sheet.kind !== "new" ? branchById.get(sheet.order.branchId) ?? null : scope.branch;

  return (
    <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
      <div className="flex min-w-0 flex-col gap-5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <ScopeControls scope={scope} allowAll dates={dates} />
        <div className="flex flex-wrap items-center gap-2">
        <ExportMenu build={buildRegister} />
        <Button
          onClick={() => setSheet({ kind: "new" })}
          disabled={!scope.branch || !scope.staff}
          title={scope.branch ? undefined : "Choose a branch to raise an order for"}
        >
          <Plus size={18} aria-hidden />
          New order
        </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-60 flex-1">
          <Search size={18} aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-ink-40" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by order number or supplier"
            aria-label="Search orders"
            className="min-h-touch-admin w-full rounded-input border border-line bg-surface pr-4 pl-10 text-body text-ink placeholder:text-ink-40 transition-colors duration-150 ease-out-pos hover:border-ink-40 focus:border-market focus:outline-2 focus:-outline-offset-2 focus:outline-market"
          />
        </div>
        <CatalogFilter products={products} value={catalog} onChange={setCatalog} />
      </div>

      <div className="grid min-w-0 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <Panel>
          <StatTile label="Still to arrive" value={formatCompact(stats.outstanding)} hint={`${stats.open} open ${stats.open === 1 ? "order" : "orders"}`} />
        </Panel>
        <Panel>
          <StatTile label="Overdue" value={String(stats.overdue)} hint={stats.overdue ? `${formatWhole(stats.overdueValue)} late` : "Nothing late"} />
        </Panel>
        <Panel>
          <StatTile label="Received on orders" value={formatCompact(stats.receivedInWindow)} hint={`${range.label} · at cost paid`} />
        </Panel>
        <Panel>
          <StatTile label="Drafts" value={String(stats.drafts)} hint={stats.drafts ? `${formatWhole(stats.draftValue)} not yet sent` : "None waiting"} />
        </Panel>
      </div>

      {notice && <Alert tone="market">{notice}</Alert>}

      <Panel>
        <PanelHeader title="Orders" meta="Press a row to see its lines, deliveries and history" />

        <div role="tablist" aria-label="Order status" className="flex flex-wrap gap-2 border-b border-line p-4">
          {TABS.map((t) => (
            <Chip
              key={t.value}
              active={tab === t.value}
              onClick={() => setTab(t.value)}
              count={filtered.filter((o) => t.match(o.progress)).length}
            >
              {t.label}
            </Chip>
          ))}
        </div>

        {shown.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title={tab === "open" ? "Nothing on order" : "No orders match"}
            detail={
              tab === "open"
                ? "Raise an order from the reorder list, or start a blank one for a supplier."
                : "Try another status, a wider date range or clearing the filters."
            }
            action={
              scope.branch && (
                <Button onClick={() => setSheet({ kind: "new" })}>
                  <Plus size={18} aria-hidden />
                  New order
                </Button>
              )
            }
          />
        ) : (
          <TableScroller>
            <table className="w-full min-w-240 text-left">
              <thead>
                <tr className="border-b border-line text-label uppercase text-ink-40">
                  <th scope="col" className="w-12 py-3 pl-4"><span className="sr-only">Expand</span></th>
                  <th scope="col" className="px-3 py-3 font-semibold">Order</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Supplier</th>
                  {showBranch && <th scope="col" className="px-3 py-3 font-semibold">Branch</th>}
                  <th scope="col" className="px-3 py-3 font-semibold">Status</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Arrived</th>
                  <th scope="col" className="px-3 py-3 text-right font-semibold">Value</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Expected</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {shown.map(({ order, progress }) => {
                  const isExpanded = open === order.id;
                  const status = STATUS[progress.status];
                  return (
                    <Fragment key={order.id}>
                      <tr
                        className={cn("cursor-pointer hover:bg-paper", isExpanded && "bg-paper")}
                        onClick={() => setOpen(isExpanded ? null : order.id)}
                      >
                        <td className="py-3 pl-4">
                          <button
                            type="button"
                            aria-expanded={isExpanded}
                            aria-label={`${isExpanded ? "Hide" : "Show"} details of ${order.reference}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              setOpen(isExpanded ? null : order.id);
                            }}
                            className="grid size-touch-admin place-items-center rounded-input text-ink-40 hover:bg-market-tint hover:text-market focus-visible:outline-2 focus-visible:outline-market"
                          >
                            {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                          </button>
                        </td>
                        <th scope="row" className="px-3 py-3">
                          <span className="block font-mono font-medium text-ink">{order.reference}</span>
                          <span className="block text-label tracking-normal text-ink-40">
                            Raised {stamp(order.createdAt)}
                          </span>
                        </th>
                        <td className="px-3 py-3">
                          <span className="block text-ink">{order.supplier}</span>
                          <span className="block text-label tracking-normal text-ink-40">
                            {order.supplierKind === "warehouse" ? "Warehouse" : "Supplier"} · {order.lines.length}{" "}
                            {order.lines.length === 1 ? "line" : "lines"}
                          </span>
                        </td>
                        {showBranch && <td className="px-3 py-3 text-ink-70">{branchById.get(order.branchId)?.name}</td>}
                        <td className="px-3 py-3">
                          <span className="flex flex-col items-start gap-1">
                            <StatusPill tone={status.tone}>{status.label}</StatusPill>
                            {progress.overdue && (
                              <StatusPill tone="stopped">
                                {progress.daysLate} {progress.daysLate === 1 ? "day" : "days"} late
                              </StatusPill>
                            )}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <Progress value={progress.fulfilment} muted={progress.status === "draft" || progress.status === "cancelled"} />
                        </td>
                        <td className="px-3 py-3 text-right">
                          <span className="block font-numeric font-semibold text-ink">{formatWhole(progress.orderedValue)}</span>
                          {isOpen(progress.status) && progress.receivedValue.kobo > 0 && (
                            <span className="block font-numeric text-label tracking-normal text-ink-40">
                              {formatWhole(progress.outstandingValue)} to come
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap text-ink-70">
                          {order.expectedOn ? dayDate(order.expectedOn) : <span className="text-ink-40">Not set</span>}
                        </td>
                        <td className="px-4 py-2 text-right whitespace-nowrap" onClick={(event) => event.stopPropagation()}>
                          <RowActions
                            status={progress.status}
                            reference={order.reference}
                            canAct={Boolean(scope.staff)}
                            onEdit={() => setSheet({ kind: "edit", order })}
                            onSend={() => send(order)}
                            onReceive={() => setSheet({ kind: "receive", order })}
                            onCancel={() => setSheet({ kind: "cancel", order })}
                          />
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-paper">
                          <td colSpan={showBranch ? 9 : 8} className="px-4 pb-5">
                            <div className="flex justify-end px-4 pt-3">
                              <ExportMenu build={() => buildPurchaseOrder(order, progress)} label="Order document" />
                            </div>
                            <OrderDetail
                              order={order}
                              progress={progress}
                              productName={(id) => productById.get(id)?.name ?? id}
                              unitOf={(id) => productById.get(id)?.unit ?? ""}
                              events={eventsFor(order.id)}
                            />
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

      {sheet && scope.staff && sheetBranch && (sheet.kind === "new" || sheet.kind === "edit") && (
        <OrderSheet
          branch={sheetBranch}
          staff={scope.staff}
          products={products}
          entries={entries.filter((e) => e.branchId === sheetBranch.id)}
          allOrders={chainOrders}
          onOrder={onOrderForBranch}
          existing={sheet.kind === "edit" ? sheet.order : undefined}
          today={today}
          knownSuppliers={knownSuppliers}
          onClose={() => setSheet(null)}
          onSaved={done}
        />
      )}

      {sheet?.kind === "receive" && scope.staff && sheetBranch && (
        <ReceiveOrderSheet
          order={sheet.order}
          progress={orderProgress(sheet.order, entries, today)}
          products={products}
          branchCode={sheetBranch.code}
          staff={scope.staff}
          today={today}
          onClose={() => setSheet(null)}
          onDone={done}
        />
      )}

      {sheet?.kind === "cancel" && scope.staff && (
        <CancelOrderSheet
          order={sheet.order}
          progress={orderProgress(sheet.order, entries, today)}
          onClose={() => setSheet(null)}
          onConfirm={(reason) => {
            const now = new Date().toISOString();
            save(
              { ...sheet.order, cancelledAt: now, cancelledBy: scope.staff!.fullName, cancelReason: reason },
              { action: "cancelled", at: now, by: scope.staff!.fullName, detail: reason },
            );
            done(`${sheet.order.reference} cancelled. It stays on the list with your reason.`);
          }}
        />
      )}
    </div>
    </main>
  );
}

/* ── Pieces ───────────────────────────────────────────────────────────────── */

function RowActions({
  status,
  reference,
  canAct,
  onEdit,
  onSend,
  onReceive,
  onCancel,
}: {
  status: OrderStatus;
  reference: string;
  canAct: boolean;
  onEdit: () => void;
  onSend: () => void;
  onReceive: () => void;
  onCancel: () => void;
}) {
  if (!canAct || status === "received" || status === "cancelled") return null;
  return (
    <span className="inline-flex items-center gap-1">
      {status === "draft" && (
        <>
          <ActionButton onClick={onEdit} icon={Pencil} label="Edit" reference={reference} />
          <ActionButton onClick={onSend} icon={Send} label="Send" reference={reference} />
        </>
      )}
      {isOpen(status) && <ActionButton onClick={onReceive} icon={PackageCheck} label="Receive" reference={reference} primary />}
      <ActionButton onClick={onCancel} icon={Ban} label="Cancel" reference={reference} danger />
    </span>
  );
}

function ActionButton({
  onClick,
  icon: Icon,
  label,
  reference,
  primary,
  danger,
}: {
  onClick: () => void;
  icon: typeof Send;
  label: string;
  reference: string;
  primary?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${label} ${reference}`}
      className={cn(
        "inline-flex min-h-touch-admin items-center gap-1.5 rounded-input px-2.5 font-medium transition-colors duration-150 ease-out-pos focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-market",
        primary
          ? "bg-market text-white hover:bg-market-dark"
          : danger
            ? "text-ink-70 hover:bg-halt-tint hover:text-halt"
            : "text-market hover:bg-market-tint",
      )}
    >
      <Icon size={16} aria-hidden />
      {label}
    </button>
  );
}

/** Share of the order's value that has arrived. The percentage is printed, never colour alone. */
function Progress({ value, muted }: { value: number; muted?: boolean }) {
  const pct = Math.round(value * 100);
  return (
    <span className="flex min-w-28 items-center gap-2">
      <span className="h-2 flex-1 overflow-hidden rounded-pill bg-line" aria-hidden>
        <span
          className={cn("block h-full rounded-pill", muted ? "bg-ink-40" : "bg-market")}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="w-10 text-right font-numeric text-label tracking-normal text-ink-70">{pct}%</span>
    </span>
  );
}

function OrderDetail({
  order,
  progress,
  productName,
  unitOf,
  events,
}: {
  order: PurchaseOrder;
  progress: OrderProgress;
  productName: (id: string) => string;
  unitOf: (id: string) => string;
  events: { action: string; at: string; by: string; detail?: string }[];
}) {
  const receipts = new Map<string, { at: string; by: string; document?: string; lines: number }>();
  for (const r of progress.receipts) {
    const key = r.ref ?? r.id;
    const existing = receipts.get(key);
    receipts.set(key, {
      at: existing?.at ?? r.at,
      by: r.staffName,
      document: r.source?.document,
      lines: (existing?.lines ?? 0) + 1,
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="overflow-x-auto rounded-input border border-line bg-surface">
        <table className="w-full min-w-150 text-left">
          <thead>
            <tr className="border-b border-line text-label uppercase text-ink-40">
              <th scope="col" className="px-4 py-2 font-semibold">Product</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Ordered</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Received</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Outstanding</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Unit cost</th>
              <th scope="col" className="px-4 py-2 text-right font-semibold">Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {progress.lines.map((l) => (
              <tr key={l.productId}>
                <th scope="row" className="px-4 py-2 font-medium text-ink">{productName(l.productId)}</th>
                <td className="px-3 py-2 text-right font-numeric text-ink-70">
                  {formatQty(l.ordered)} {unitOf(l.productId)}
                </td>
                <td className="px-3 py-2 text-right font-numeric text-ink">{formatQty(l.received)}</td>
                <td className={cn("px-3 py-2 text-right font-numeric", l.outstanding.milli > 0 && isOpen(progress.status) ? "font-semibold text-ink" : "text-ink-40")}>
                  {formatQty(l.outstanding)}
                </td>
                <td className="px-3 py-2 text-right font-numeric text-ink-70">{formatWhole(l.unitCost)}</td>
                <td className="px-4 py-2 text-right font-numeric text-ink">{formatWhole(l.orderedValue)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line font-semibold text-ink">
              <th scope="row" className="px-4 py-2 text-left">Total</th>
              <td colSpan={4} className="px-3 py-2 text-right text-label font-normal tracking-normal text-ink-40">
                {formatWhole(progress.receivedValue)} received at cost paid
              </td>
              <td className="px-4 py-2 text-right font-numeric">{formatWhole(progress.orderedValue)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex flex-col gap-3">
        {order.note && (
          <p className="rounded-input border border-line bg-surface px-3 py-2 text-body text-ink-70">
            <span className="font-semibold text-ink">Note: </span>
            {order.note}
          </p>
        )}
        {order.cancelReason && (
          <Alert tone="signal" title={`Cancelled by ${order.cancelledBy ?? "—"}`}>
            {order.cancelReason}
          </Alert>
        )}
        <div className="rounded-input border border-line bg-surface">
          <p className="border-b border-line px-3 py-2 text-label uppercase text-ink-40">Deliveries against this order</p>
          {receipts.size === 0 ? (
            <p className="px-3 py-3 text-body text-ink-70">Nothing received yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {[...receipts.entries()].map(([ref, r]) => (
                <li key={ref} className="px-3 py-2 text-body">
                  <span className="block font-mono text-ink">{ref}</span>
                  <span className="block text-ink-70">
                    {stamp(r.at)} · {r.by} · {r.lines} {r.lines === 1 ? "line" : "lines"}
                    {r.document ? ` · ${r.document}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-input border border-line bg-surface">
          <p className="border-b border-line px-3 py-2 text-label uppercase text-ink-40">History</p>
          <ul className="divide-y divide-line">
            <li className="px-3 py-2 text-body text-ink-70">
              Raised by {order.createdBy} · {stamp(order.createdAt)}
            </li>
            {events
              .filter((e) => e.action !== "raised")
              .map((e, i) => (
                <li key={i} className="px-3 py-2 text-body text-ink-70">
                  <span className="font-medium text-ink capitalize">{e.action}</span> by {e.by} · {stamp(e.at)}
                  {e.detail && <span className="block text-ink-40">{e.detail}</span>}
                </li>
              ))}
            {order.sentAt && !events.some((e) => e.action === "sent") && (
              <li className="px-3 py-2 text-body text-ink-70">
                <span className="font-medium text-ink">Sent</span> · {stamp(order.sentAt)}
              </li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}

function CancelOrderSheet({
  order,
  progress,
  onClose,
  onConfirm,
}: {
  order: PurchaseOrder;
  progress: OrderProgress;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  const short = reason.trim().length < 3;
  const partly = progress.receivedValue.kobo > 0;

  return (
    <Sheet
      title={`Cancel ${order.reference}`}
      subtitle={order.supplier}
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        setTried(true);
        if (!short) onConfirm(reason.trim());
      }}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} className="flex-1">
            Keep the order
          </Button>
          <Button type="submit" variant="danger" className="flex-1">
            <Ban size={18} aria-hidden />
            Cancel order
          </Button>
        </>
      }
    >
      <Alert tone="signal" title="The order is kept, not deleted">
        It stays on the list marked cancelled, with your name and reason.
        {partly && (
          <>
            {" "}
            {formatWhole(progress.receivedValue)} has already been received against it — that stock
            stays in; only the {formatWhole(progress.outstandingValue)} still outstanding is called off.
          </>
        )}
      </Alert>
      <label className="flex flex-col gap-1">
        <span className="text-body font-semibold text-ink">
          Reason <span aria-hidden className="text-halt">*</span>
          <span className="sr-only">(required)</span>
        </span>
        <textarea
          rows={3}
          autoFocus
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="e.g. Supplier cannot deliver this week — reordered from the warehouse"
          aria-invalid={(tried && short) || undefined}
          className={cn(
            "rounded-input border bg-surface px-3 py-2.5 text-body text-ink placeholder:text-ink-40 focus:border-market focus:outline-2 focus:-outline-offset-2 focus:outline-market",
            tried && short ? "border-halt" : "border-line hover:border-ink-40",
          )}
        />
        {tried && short && (
          <span className="flex items-center gap-1.5 text-body text-halt">
            <TriangleAlert size={15} aria-hidden />
            Say why — it is the first thing anyone asks.
          </span>
        )}
      </label>
    </Sheet>
  );
}
