"use client";

import { Fragment, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChartColumn,
  ChevronDown,
  ChevronRight,
  Search,
} from "lucide-react";
import { SalesColumnChart } from "@/components/shared/hourly-sales-chart";
import {
  CatalogFilter,
  Chip,
  ScopeControls,
  matchesCatalog,
  useCatalogFilter,
} from "@/components/inventory/scope-controls";
import { Alert } from "@/components/ui/alert";
import { ExportMenu } from "@/components/ui/export-menu";
import { moneyCell, qtyCell, reportFilename, type ReportSpec } from "@/lib/export/report";
import { formatBasisPoints } from "@/lib/domain/product-master";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatTile } from "@/components/ui/stat-tile";
import { TableScroller } from "@/components/ui/table-scroller";
import { searchProducts } from "@/lib/domain/catalog";
import {
  activityMoved,
  dailyTrade,
  daysIn,
  productActivity,
  summariseSales,
  type ActivityRow,
} from "@/lib/domain/inventory";
import { ZERO, formatCompact, formatWhole, multiply, sum, type Money } from "@/lib/domain/money";
import { formatQty, type Quantity } from "@/lib/domain/quantity";
import { STOCK_REASON_LABEL } from "@/lib/domain/stock";
import { useWorkspaceProducts } from "@/lib/data/workspace-data";
import { ALL_BRANCHES, useDayRange, useInventoryScope, useScopedLedger } from "@/lib/hooks/use-inventory";
import { isoDay, shortDate, stamp } from "@/lib/utils/format-date";
import { cn } from "@/lib/utils/cn";
import type { Product } from "@/types/catalog";
import type { StockEntry } from "@/types/stock";

/**
 * Stock and sales — SPEC §15.2, §15.3.
 *
 * Every product, in units and in naira, for any window: what it opened with,
 * what was bought, what was sold and for how much, what was lost, and what it
 * closed on. The row adds up across in units — opening + purchased − sold −
 * wasted ± transfers ± adjusted = closing — because every column is cut from
 * the same ledger rows (CLAUDE.md rule 3).
 *
 * Values: stock at catalog cost, purchases at the cost actually paid, sales at
 * what customers actually paid (shelf price where a movement has no receipt,
 * and the screen says how much that is).
 */

type SortKey = "name" | "opening" | "purchased" | "sold" | "profit" | "wasted" | "closing";
type Sort = { key: SortKey; desc: boolean };

const SORT_VALUE: Record<Exclude<SortKey, "name">, (r: ActivityRow) => number> = {
  opening: (r) => r.openingValue.kobo,
  purchased: (r) => r.purchasedValue.kobo,
  sold: (r) => r.salesValue.kobo,
  profit: (r) => r.grossProfit.kobo,
  wasted: (r) => r.wastedValue.kobo,
  closing: (r) => r.closingValue.kobo,
};

const margin = (profit: Money, sales: Money) =>
  sales.kobo > 0 ? `${((profit.kobo / sales.kobo) * 100).toFixed(1)}%` : "—";

export function StockSalesScreen({ today }: { today: string }) {
  const scope = useInventoryScope({ allowAll: true });
  const { entries, sales } = useScopedLedger(scope.branchId);
  const products = useWorkspaceProducts();
  const dates = useDayRange(today, "all");
  const { range } = dates;
  const [catalog, setCatalog] = useCatalogFilter();
  const [query, setQuery] = useState("");
  const [movedOnly, setMovedOnly] = useState(true);
  const [sort, setSort] = useState<Sort>({ key: "sold", desc: true });
  const [chart, setChart] = useState<"sales" | "purchases">("sales");
  const [open, setOpen] = useState<string | null>(null);

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const pricing = useMemo(
    () => ({
      costOf: (id: string) => productById.get(id)?.cost ?? ZERO,
      priceOf: (id: string) => productById.get(id)?.price ?? ZERO,
    }),
    [productById],
  );

  const inScope = useMemo(() => {
    const ids = new Set(
      searchProducts(products, query)
        .filter((p) => matchesCatalog(p, catalog))
        .map((p) => p.id),
    );
    return (productId: string) => ids.has(productId);
  }, [products, query, catalog]);

  const activity = useMemo(
    () => productActivity(entries, sales, range.instants, pricing),
    [entries, sales, range, pricing],
  );

  const rows = useMemo(() => {
    const list = [...activity.values()]
      .filter((r) => inScope(r.productId) && (!movedOnly || activityMoved(r)))
      .map((r) => ({ row: r, product: productById.get(r.productId) }))
      .filter((r): r is { row: ActivityRow; product: Product } => Boolean(r.product));
    const dir = sort.desc ? -1 : 1;
    return list.sort((a, b) =>
      sort.key === "name"
        ? dir * a.product.name.localeCompare(b.product.name)
        : dir * (SORT_VALUE[sort.key](a.row) - SORT_VALUE[sort.key](b.row)) ||
          a.product.name.localeCompare(b.product.name),
    );
  }, [activity, inScope, movedOnly, productById, sort]);

  const totals = useMemo(() => {
    const all = [...activity.values()].filter((r) => inScope(r.productId));
    const s = (pick: (r: ActivityRow) => Money) => sum(all.map(pick));
    return {
      opening: s((r) => r.openingValue),
      purchased: s((r) => r.purchasedValue),
      sales: s((r) => r.salesValue),
      estimated: s((r) => r.estimatedSales),
      cost: s((r) => r.costOfSales),
      profit: s((r) => r.grossProfit),
      wasted: s((r) => r.wastedValue),
      closing: s((r) => r.closingValue),
      lines: all.filter(activityMoved).length,
    };
  }, [activity, inScope]);

  /** The one selected product, when the filter narrows to a single line. */
  const single = catalog.productId !== "all" ? activity.get(catalog.productId) ?? null : null;
  const singleUnit = single ? productById.get(single.productId)?.unit ?? "" : "";
  const qtyHint = (q: Quantity) => (single ? `${formatQty(q)} ${singleUnit}` : null);

  const receipts = useMemo(
    () => summariseSales(sales, range.instants, (iso) => isoDay(iso)),
    [sales, range],
  );

  // The chart starts at the first day anything happened, not at the start of
  // "All time", and turns weekly past two months so every column stays
  // readable and no part of the window silently falls off the left edge.
  const chartDays = useMemo(() => {
    let first = range.toDay;
    for (const e of entries) {
      const d = isoDay(e.at);
      if (d < first) first = d;
    }
    return daysIn(first > range.fromDay ? first : range.fromDay, range.toDay);
  }, [entries, range]);

  const daily = useMemo(
    () => dailyTrade(entries, sales, range.instants, (iso) => isoDay(iso), chartDays, pricing, inScope),
    [entries, sales, range, chartDays, pricing, inScope],
  );

  const weekly = chartDays.length > 62;
  const columns = useMemo(() => {
    const pick = (d: (typeof daily)[number]) =>
      chart === "sales"
        ? { total: d.salesValue, count: d.transactions }
        : { total: d.purchasesValue, count: d.deliveries };
    if (!weekly) {
      return daily.map((d) => ({ key: d.day, label: shortDate(d.day), tick: shortDate(d.day), total: pick(d).total, transactions: pick(d).count }));
    }
    const out = [];
    for (let i = 0; i < daily.length; i += 7) {
      const week = daily.slice(i, i + 7);
      out.push({
        key: week[0].day,
        label: `Week of ${shortDate(week[0].day)}`,
        tick: shortDate(week[0].day),
        total: sum(week.map((d) => pick(d).total)),
        transactions: week.reduce((n, d) => n + pick(d).count, 0),
      });
    }
    return out;
  }, [daily, chart, weekly]);

  const byCategory = useMemo(() => {
    const map = new Map<string, { name: string; purchased: Money; sales: Money; profit: Money; wasted: Money; closing: Money }>();
    for (const { row, product } of rows) {
      const c = map.get(product.categoryId) ?? {
        name: product.categoryName,
        purchased: ZERO,
        sales: ZERO,
        profit: ZERO,
        wasted: ZERO,
        closing: ZERO,
      };
      map.set(product.categoryId, {
        name: c.name,
        purchased: sum([c.purchased, row.purchasedValue]),
        sales: sum([c.sales, row.salesValue]),
        profit: sum([c.profit, row.grossProfit]),
        wasted: sum([c.wasted, row.wastedValue]),
        closing: sum([c.closing, row.closingValue]),
      });
    }
    return [...map.values()].sort((a, b) => b.sales.kobo - a.sales.kobo);
  }, [rows]);

  const movementsOf = (productId: string) =>
    entries
      .filter((e) => {
        const t = Date.parse(e.at);
        return e.productId === productId && t >= Date.parse(range.instants.from) && t < Date.parse(range.instants.to);
      })
      .sort((a, b) => b.at.localeCompare(a.at));

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key !== "name" }));
  }

  /** The report as it stands on screen: filters, period and all. */
  const buildReport = (): ReportSpec => {
    const scopeName = scope.branchId === ALL_BRANCHES ? "All branches" : (scope.branch?.name ?? "Branch");
    const marginOf = (r: { grossProfit: Money; salesValue: Money }) =>
      formatBasisPoints(r.salesValue.kobo > 0 ? Math.round((r.grossProfit.kobo * 10_000) / r.salesValue.kobo) : null);
    const filterLabel = [
      catalog.productId !== "all"
        ? productById.get(catalog.productId)?.name
        : catalog.categoryId !== "all"
          ? products.find((p) => p.categoryId === catalog.categoryId)?.categoryName
          : "All products",
      query.trim() ? `matching “${query.trim()}”` : null,
      movedOnly ? "lines that moved" : null,
    ].filter(Boolean).join(" · ");
    const lead = (p: Product) => [p.sku, p.name];
    const leadCols = [
      { header: "Part no.", mono: true, width: 9 },
      { header: "Product", width: 24 },
    ];

    return {
      title: "Stock & sales",
      subtitle: `${scopeName} · takings, margin and stock reconciliation`,
      filename: reportFilename("stock-and-sales", scope.branch?.code ?? "chain", range.fromDay, range.toDay),
      orientation: "landscape",
      meta: [
        { label: "Scope", value: scopeName },
        { label: "Period", value: `${range.label} · ${range.fromDay} to ${range.toDay}` },
        { label: "Showing", value: filterLabel },
        { label: "Lines", value: String(rows.length) },
      ],
      summary: [
        { label: "Sales", value: formatWhole(totals.sales), hint: totals.estimated.kobo ? `${formatWhole(totals.estimated)} at shelf price` : "From receipts" },
        { label: "Gross profit", value: formatWhole(totals.profit), hint: `Margin ${marginOf({ grossProfit: totals.profit, salesValue: totals.sales })}` },
        { label: "Purchases", value: formatWhole(totals.purchased), hint: "At cost paid" },
        { label: "Wasted", value: formatWhole(totals.wasted), hint: "Written off, at cost" },
        { label: "Closing stock", value: formatWhole(totals.closing), hint: "At cost" },
      ],
      tables: [
        {
          heading: "Sales and margin by product",
          columns: [
            ...leadCols,
            { header: "Sold", align: "right", width: 8 },
            { header: "Sales", align: "right", width: 11 },
            { header: "Cost of sales", align: "right", width: 11 },
            { header: "Gross profit", align: "right", width: 11 },
            { header: "Margin", align: "right", width: 7 },
          ],
          rows: rows.map(({ row: r, product: p }) => [
            ...lead(p),
            qtyCell(r.sold, p.unit),
            moneyCell(r.salesValue),
            moneyCell(r.costOfSales),
            moneyCell(r.grossProfit),
            marginOf(r),
          ]),
          totals: ["", "Total", "", moneyCell(sum(rows.map((x) => x.row.salesValue)), { bold: true }), moneyCell(sum(rows.map((x) => x.row.costOfSales)), { bold: true }), moneyCell(sum(rows.map((x) => x.row.grossProfit)), { bold: true }), ""],
          empty: "Nothing sold in this period.",
        },
        {
          heading: "Stock reconciliation",
          note: "Opening + purchased − sold − wasted ± transfers ± adjustments = closing. Every figure is a sum of ledger movements.",
          columns: [
            ...leadCols,
            { header: "Opening", align: "right", width: 8 },
            { header: "Purchased", align: "right", width: 8 },
            { header: "Sold", align: "right", width: 7 },
            { header: "Wasted", align: "right", width: 7 },
            { header: "Transfers", align: "right", width: 8 },
            { header: "Adjusted", align: "right", width: 8 },
            { header: "Closing", align: "right", width: 8 },
            { header: "Closing value", align: "right", width: 11 },
          ],
          rows: rows.map(({ row: r, product: p }) => [
            ...lead(p),
            qtyCell(r.opening),
            qtyCell(r.purchased),
            qtyCell(r.sold),
            qtyCell(r.wasted),
            qtyCell(r.transfers, undefined, { signed: true }),
            qtyCell(r.adjusted, undefined, { signed: true }),
            qtyCell(r.closing),
            moneyCell(r.closingValue),
          ]),
          totals: ["", "Total", "", "", "", "", "", "", "", moneyCell(sum(rows.map((x) => x.row.closingValue)), { bold: true })],
        },
        {
          heading: "By category",
          columns: [
            { header: "Category", width: 22 },
            { header: "Purchases", align: "right", width: 13 },
            { header: "Sales", align: "right", width: 13 },
            { header: "Gross profit", align: "right", width: 13 },
            { header: "Margin", align: "right", width: 9 },
            { header: "Wasted", align: "right", width: 12 },
            { header: "Closing stock", align: "right", width: 13 },
          ],
          rows: byCategory.map((c) => [
            c.name,
            moneyCell(c.purchased),
            moneyCell(c.sales),
            moneyCell(c.profit),
            marginOf({ grossProfit: c.profit, salesValue: c.sales }),
            moneyCell(c.wasted),
            moneyCell(c.closing),
          ]),
        },
        {
          heading: "Trade by day",
          columns: [
            { header: "Day", width: 20 },
            { header: "Sales", align: "right", width: 20 },
            { header: "Transactions", align: "right", width: 15 },
            { header: "Purchases", align: "right", width: 20 },
            { header: "Deliveries", align: "right", width: 15 },
          ],
          rows: daily
            .filter((d) => d.salesValue.kobo !== 0 || d.purchasesValue.kobo !== 0)
            .map((d) => [d.day, moneyCell(d.salesValue), String(d.transactions), moneyCell(d.purchasesValue), String(d.deliveries)]),
          empty: "No trade in this period.",
        },
      ],
      csv: [
        {
          columns: [
            "Part no.", "Product", "Category", "Unit",
            "Opening qty", "Opening value",
            "Purchased qty", "Purchased value",
            "Sold qty", "Sales value", "Cost of sales", "Gross profit", "Margin %",
            "Wasted qty", "Wasted value", "Expired qty",
            "Transfers qty", "Adjusted qty",
            "Closing qty", "Closing value",
          ].map((header) => ({ header })),
          rows: rows.map(({ row: r, product: p }) => [
            p.sku, p.name, p.categoryName, p.unit,
            qtyCell(r.opening), moneyCell(r.openingValue),
            qtyCell(r.purchased), moneyCell(r.purchasedValue),
            qtyCell(r.sold), moneyCell(r.salesValue), moneyCell(r.costOfSales), moneyCell(r.grossProfit),
            r.salesValue.kobo > 0 ? Math.round((r.grossProfit.kobo * 10_000) / r.salesValue.kobo) / 100 : "",
            qtyCell(r.wasted), moneyCell(r.wastedValue), qtyCell(r.expired),
            qtyCell(r.transfers), qtyCell(r.adjusted),
            qtyCell(r.closing), moneyCell(r.closingValue),
          ]),
        },
      ],
      footnote:
        "Sales are valued from receipts where the till recorded them, otherwise at shelf price. Cost of sales, waste and stock are at catalog cost.",
    };
  };

  const chartHasData = columns.some((c) => c.total.kobo !== 0);

  return (
    <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
      <div className="flex min-w-0 flex-col gap-5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <ScopeControls scope={scope} allowAll dates={dates} />
        <ExportMenu build={buildReport} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-60 flex-1">
          <Search size={18} aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-ink-40" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search products by name or SKU"
            aria-label="Search products"
            className="min-h-touch-admin w-full rounded-input border border-line bg-surface pr-4 pl-10 text-body text-ink placeholder:text-ink-40 transition-colors duration-150 ease-out-pos hover:border-ink-40 focus:border-market focus:outline-2 focus:-outline-offset-2 focus:outline-market"
          />
        </div>
        <CatalogFilter products={products} value={catalog} onChange={setCatalog} />
        <Checkbox label="Only lines that moved" checked={movedOnly} onChange={(event) => setMovedOnly(event.target.checked)} />
      </div>

      <div className="grid min-w-0 gap-5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        <Panel>
          <StatTile label="Opening stock" value={formatCompact(totals.opening)} hint={qtyHint(single?.opening ?? { milli: 0 }) ?? `At cost, start of ${shortDate(range.fromDay)}`} />
        </Panel>
        <Panel>
          <StatTile label="Purchases" value={formatCompact(totals.purchased)} hint={qtyHint(single?.purchased ?? { milli: 0 }) ?? "At cost paid"} />
        </Panel>
        <Panel>
          <StatTile
            label="Sales"
            value={formatCompact(totals.sales)}
            hint={
              qtyHint(single?.sold ?? { milli: 0 }) ??
              (receipts.transactions ? `${receipts.transactions} till receipts · avg ${formatWhole(receipts.averageBasket)}` : "At selling price")
            }
          />
        </Panel>
        <Panel>
          <StatTile label="Gross profit" value={formatCompact(totals.profit)} hint={`${margin(totals.profit, totals.sales)} margin`} />
        </Panel>
        <Panel>
          <StatTile label="Wastage" value={formatCompact(totals.wasted)} hint={qtyHint(single?.wasted ?? { milli: 0 }) ?? "Expired, damaged, stolen"} />
        </Panel>
        <Panel>
          <StatTile label="Closing stock" value={formatCompact(totals.closing)} hint={qtyHint(single?.closing ?? { milli: 0 }) ?? `At cost, end of ${shortDate(range.toDay)}`} />
        </Panel>
      </div>

      {totals.estimated.kobo > 0 && (
        <Alert
          tone="info"
          title={totals.estimated.kobo === totals.sales.kobo ? "The sales figure is an estimate" : "Part of the sales figure is an estimate"}
        >
          {totals.estimated.kobo === totals.sales.kobo
            ? `All ${formatWhole(totals.sales)} of these sales comes`
            : `${formatWhole(totals.estimated)} of the ${formatWhole(totals.sales)} in sales comes`}{" "}
          from stock movements with no till receipt on this device, so it is valued at today&rsquo;s shelf
          price. Everything rung at the till here is valued at what the customer actually paid.
        </Alert>
      )}

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Panel>
          <PanelHeader
            title={`${chart === "sales" ? "Sales" : "Purchases"} by ${weekly ? "week" : "day"}`}
            meta={`${shortDate(chartDays[0] ?? range.fromDay)} to ${shortDate(range.toDay)}`}
            action={
              <div role="group" aria-label="Chart shows" className="flex gap-1.5">
                <Chip active={chart === "sales"} onClick={() => setChart("sales")}>Sales</Chip>
                <Chip active={chart === "purchases"} onClick={() => setChart("purchases")}>Purchases</Chip>
              </div>
            }
          />
          {!chartHasData ? (
            <EmptyState
              icon={ChartColumn}
              title={chart === "sales" ? "No sales in this window" : "No purchases in this window"}
              detail="Try a wider date range, or clear the product filter."
            />
          ) : (
            <div className="pb-5">
              <SalesColumnChart
                caption={chart === "sales" ? "Sales by day" : "Purchases by day"}
                keyHeading={weekly ? "Week" : "Day"}
                countNoun={chart === "sales" ? "receipts" : "deliveries"}
                buckets={columns}
              />
            </div>
          )}
        </Panel>

        <Panel>
          <PanelHeader title="Best sellers" meta="By sales value" />
          {rows.filter((r) => r.row.sold.milli > 0).length === 0 ? (
            <p className="px-5 py-6 text-body text-ink-70">Nothing sold in this window.</p>
          ) : (
            <ol className="divide-y divide-line">
              {[...rows]
                .filter((r) => r.row.sold.milli > 0)
                .sort((a, b) => b.row.salesValue.kobo - a.row.salesValue.kobo)
                .slice(0, 8)
                .map(({ row, product }, i) => (
                  <li key={product.id} className="flex items-center gap-3 px-5 py-2.5">
                    <span className="w-5 shrink-0 font-numeric text-label tracking-normal text-ink-40">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-ink">{product.name}</span>
                      <span className="block text-label tracking-normal text-ink-40">
                        {formatQty(row.sold)} {product.unit} · {margin(row.grossProfit, row.salesValue)} margin
                      </span>
                    </span>
                    <span className="shrink-0 text-right font-numeric font-semibold text-ink">{formatWhole(row.salesValue)}</span>
                  </li>
                ))}
            </ol>
          )}
        </Panel>
      </div>

      <Panel>
        <PanelHeader
          title="Products — quantity and value"
          meta="Opening + purchased − sold − wasted ± transfers ± adjusted = closing. Value under each figure."
        />
        {rows.length === 0 ? (
          <EmptyState
            icon={ChartColumn}
            title={query || catalog.productId !== "all" || catalog.categoryId !== "all" ? "No products match" : "No stock moved in this window"}
            detail="Widen the date range, clear the filters, or untick “Only lines that moved”."
          />
        ) : (
          <TableScroller>
            <table className="w-full min-w-300 text-left">
              <thead>
                <tr className="border-b border-line text-label uppercase text-ink-40">
                  <th scope="col" className="w-10 py-3 pl-3"><span className="sr-only">Expand</span></th>
                  <SortHeader label="Product" k="name" sort={sort} onSort={toggleSort} align="left" />
                  <SortHeader label="Opening" k="opening" sort={sort} onSort={toggleSort} />
                  <SortHeader label="Purchased" k="purchased" sort={sort} onSort={toggleSort} />
                  <SortHeader label="Sold" k="sold" sort={sort} onSort={toggleSort} />
                  <SortHeader label="Gross profit" k="profit" sort={sort} onSort={toggleSort} />
                  <SortHeader label="Wasted" k="wasted" sort={sort} onSort={toggleSort} />
                  <th scope="col" className="px-3 py-3 text-right font-semibold" title="Net of transfers in and out">Transfers</th>
                  <th scope="col" className="px-3 py-3 text-right font-semibold" title="Count adjustments and corrections">Adjusted</th>
                  <SortHeader label="Closing" k="closing" sort={sort} onSort={toggleSort} />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map(({ row: r, product: p }) => {
                  const expanded = open === p.id;
                  return (
                    <Fragment key={p.id}>
                      <tr className={cn("cursor-pointer align-top hover:bg-paper", expanded && "bg-paper")} onClick={() => setOpen(expanded ? null : p.id)}>
                        <td className="py-2.5 pl-3">
                          <button
                            type="button"
                            aria-expanded={expanded}
                            aria-label={`${expanded ? "Hide" : "Show"} movements of ${p.name}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              setOpen(expanded ? null : p.id);
                            }}
                            className="grid size-touch-admin place-items-center rounded-input text-ink-40 hover:bg-market-tint hover:text-market focus-visible:outline-2 focus-visible:outline-market"
                          >
                            {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                          </button>
                        </td>
                        <th scope="row" className="px-3 py-3 font-medium text-ink">
                          {p.name}
                          <span className="block font-mono text-label tracking-normal text-ink-40">
                            {p.sku} · {p.categoryName} · {p.unit}
                          </span>
                        </th>
                        <Cell qty={r.opening} value={r.openingValue} />
                        <Cell qty={r.purchased} value={r.purchasedValue} sign="+" />
                        <Cell qty={r.sold} value={r.salesValue} sign="−" estimated={r.estimatedSales.kobo > 0} />
                        <td className="px-3 py-3 text-right">
                          <span className={cn("block font-numeric font-semibold", r.grossProfit.kobo < 0 ? "text-halt" : "text-ink")}>
                            {formatWhole(r.grossProfit)}
                          </span>
                          <span className="block font-numeric text-label tracking-normal text-ink-40">
                            {margin(r.grossProfit, r.salesValue)}
                          </span>
                        </td>
                        <Cell qty={r.wasted} value={r.wastedValue} sign="−" alert />
                        <td className="px-3 py-3 text-right"><Signed value={r.transfers} /></td>
                        <td className="px-3 py-3 text-right"><Signed value={r.adjusted} /></td>
                        <Cell qty={r.closing} value={r.closingValue} strong />
                      </tr>
                      {expanded && (
                        <tr className="bg-paper">
                          <td colSpan={10} className="px-4 pb-4">
                            <Movements entries={movementsOf(p.id)} product={p} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line bg-paper font-semibold text-ink">
                  <td />
                  <th scope="row" className="px-3 py-3 text-left">
                    Total value
                    <span className="block text-label font-normal tracking-normal text-ink-40">
                      {totals.lines} {totals.lines === 1 ? "line" : "lines"} moved · units are not added across products
                    </span>
                  </th>
                  <td className="px-3 py-3 text-right font-numeric">{formatWhole(totals.opening)}</td>
                  <td className="px-3 py-3 text-right font-numeric">{formatWhole(totals.purchased)}</td>
                  <td className="px-3 py-3 text-right font-numeric">{formatWhole(totals.sales)}</td>
                  <td className="px-3 py-3 text-right font-numeric">
                    {formatWhole(totals.profit)}
                    <span className="block text-label font-normal tracking-normal text-ink-40">{margin(totals.profit, totals.sales)}</span>
                  </td>
                  <td className="px-3 py-3 text-right font-numeric">{formatWhole(totals.wasted)}</td>
                  <td colSpan={2} />
                  <td className="px-3 py-3 text-right font-numeric">{formatWhole(totals.closing)}</td>
                </tr>
              </tfoot>
            </table>
          </TableScroller>
        )}
      </Panel>

      {byCategory.length > 1 && (
        <Panel>
          <PanelHeader title="By category" meta="Values for the products shown above" />
          <TableScroller>
            <table className="w-full min-w-170 text-left">
              <thead>
                <tr className="border-b border-line text-label uppercase text-ink-40">
                  <th scope="col" className="px-5 py-3 font-semibold">Category</th>
                  <th scope="col" className="px-3 py-3 text-right font-semibold">Purchases</th>
                  <th scope="col" className="px-3 py-3 text-right font-semibold">Sales</th>
                  <th scope="col" className="px-3 py-3 text-right font-semibold">Gross profit</th>
                  <th scope="col" className="px-3 py-3 text-right font-semibold">Wastage</th>
                  <th scope="col" className="px-5 py-3 text-right font-semibold">Closing stock</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {byCategory.map((c) => (
                  <tr key={c.name} className="hover:bg-paper">
                    <th scope="row" className="px-5 py-3 font-medium text-ink">{c.name}</th>
                    <td className="px-3 py-3 text-right font-numeric text-ink-70">{formatWhole(c.purchased)}</td>
                    <td className="px-3 py-3 text-right font-numeric text-ink">{formatWhole(c.sales)}</td>
                    <td className="px-3 py-3 text-right font-numeric text-ink">
                      {formatWhole(c.profit)} <span className="text-label tracking-normal text-ink-40">{margin(c.profit, c.sales)}</span>
                    </td>
                    <td className={cn("px-3 py-3 text-right font-numeric", c.wasted.kobo > 0 ? "text-halt" : "text-ink-40")}>{formatWhole(c.wasted)}</td>
                    <td className="px-5 py-3 text-right font-numeric text-ink-70">{formatWhole(c.closing)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroller>
        </Panel>
      )}
    </div>
    </main>
  );
}

/* ── Pieces ───────────────────────────────────────────────────────────────── */

function SortHeader({
  label,
  k,
  sort,
  onSort,
  align = "right",
}: {
  label: string;
  k: SortKey;
  sort: Sort;
  onSort: (k: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = sort.key === k;
  const Icon = sort.desc ? ArrowDown : ArrowUp;
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.desc ? "descending" : "ascending") : "none"}
      className={cn("px-3 py-2 font-semibold", align === "right" ? "text-right" : "text-left")}
    >
      <button
        type="button"
        onClick={() => onSort(k)}
        className={cn(
          "inline-flex min-h-9 items-center gap-1 rounded-input px-1 uppercase hover:text-ink focus-visible:outline-2 focus-visible:outline-market",
          active && "text-ink",
        )}
      >
        {label}
        {active && <Icon size={13} aria-hidden />}
      </button>
    </th>
  );
}

/** A quantity with its value beneath. The sign carries direction, never colour alone (§14). */
function Cell({
  qty,
  value,
  sign,
  strong,
  alert,
  estimated,
}: {
  qty: Quantity;
  value: Money;
  sign?: "+" | "−";
  strong?: boolean;
  alert?: boolean;
  estimated?: boolean;
}) {
  if (qty.milli === 0 && value.kobo === 0) {
    return <td className="px-3 py-3 text-right font-numeric text-ink-40">·</td>;
  }
  return (
    <td className="px-3 py-3 text-right whitespace-nowrap">
      <span
        className={cn(
          "block font-numeric",
          strong ? "font-semibold" : "",
          qty.milli < 0 ? "text-halt" : alert ? "font-semibold text-halt" : sign === "+" ? "text-market" : "text-ink",
        )}
      >
        {sign && qty.milli > 0 ? sign : ""}
        {formatQty(qty)}
      </span>
      <span className="block font-numeric text-label tracking-normal text-ink-40">
        {estimated ? "≈ " : ""}
        {formatWhole(value)}
      </span>
    </td>
  );
}

function Signed({ value }: { value: Quantity }) {
  if (value.milli === 0) return <span className="font-numeric text-ink-40">·</span>;
  return (
    <span className="font-numeric text-ink">
      {value.milli > 0 ? "+" : "−"}
      {formatQty({ milli: Math.abs(value.milli) })}
    </span>
  );
}

function Movements({
  entries,
  product,
}: {
  entries: StockEntry[];
  product: Product;
}) {
  const shown = entries.slice(0, 60);
  if (shown.length === 0) {
    return <p className="rounded-input border border-line bg-surface px-4 py-3 text-body text-ink-70">No movements in this window.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-input border border-line bg-surface">
      <table className="w-full min-w-160 text-left">
        <thead>
          <tr className="border-b border-line text-label uppercase text-ink-40">
            <th scope="col" className="px-4 py-2 font-semibold">When</th>
            <th scope="col" className="px-3 py-2 font-semibold">What</th>
            <th scope="col" className="px-3 py-2 text-right font-semibold">Qty</th>
            <th scope="col" className="px-3 py-2 text-right font-semibold">Value</th>
            <th scope="col" className="px-3 py-2 font-semibold">By</th>
            <th scope="col" className="px-4 py-2 font-semibold">Reference</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {shown.map((e) => {
            const unitValue = e.reason === "PURCHASE_RECEIPT" ? e.unitCost ?? product.cost : e.reason === "SALE" ? product.price : product.cost;
            return (
              <tr key={e.id}>
                <td className="px-4 py-2 font-numeric whitespace-nowrap text-ink-70">{stamp(e.at)}</td>
                <td className="px-3 py-2 text-ink">
                  {STOCK_REASON_LABEL[e.reason]}
                  {e.source && <span className="block text-label tracking-normal text-ink-40">{e.source.name}</span>}
                </td>
                <td className={cn("px-3 py-2 text-right font-numeric font-semibold whitespace-nowrap", e.delta.milli > 0 ? "text-market" : "text-ink")}>
                  {e.delta.milli > 0 ? "+" : "−"}
                  {formatQty({ milli: Math.abs(e.delta.milli) })} {product.unit}
                </td>
                <td className="px-3 py-2 text-right font-numeric text-ink-70">
                  {formatWhole(multiply(unitValue, Math.abs(e.delta.milli) / 1000))}
                </td>
                <td className="px-3 py-2 text-ink-70">{e.staffName}</td>
                <td className="px-4 py-2 font-mono text-label tracking-normal text-ink-40">
                  {e.ref ?? "—"}
                  {e.orderRef && <span className="block">for {e.orderRef}</span>}
                  {e.note && <span className="block font-sans">{e.note}</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {entries.length > shown.length && (
        <p className="border-t border-line px-4 py-2 text-label tracking-normal text-ink-40">
          Showing the latest {shown.length} of {entries.length}. Narrow the dates to see the rest.
        </p>
      )}
    </div>
  );
}
